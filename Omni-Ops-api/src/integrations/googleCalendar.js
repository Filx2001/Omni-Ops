const { google } = require("googleapis");
const googleAuth = require("./googleAuth");

// Per-tenant calendar when eventData.workspaceId is present, host fallback otherwise
async function resolveClient(eventData) {
  if (eventData?.workspaceId) {
    const ctx = await googleAuth.getAuthForWorkspace(eventData.workspaceId);
    if (ctx?.auth) {
      return {
        client: google.calendar({ version: "v3", auth: ctx.auth }),
        calendarId:
          eventData.calendarId || ctx.ws?.googleCalendarId || process.env.GOOGLE_CALENDAR_ID,
      };
    }
  }
  const client = getClient();
  return client
    ? { client, calendarId: eventData.calendarId || process.env.GOOGLE_CALENDAR_ID }
    : null;
}

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

let auth = null;
let calendar = null;

// Lazy initialization — if Google credentials aren't configured,
// the API still starts, but calendar sync functions will gracefully no-op.
function getClient() {
  if (calendar) return calendar;
  try {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!raw) {
      console.warn("[Google] GOOGLE_CREDENTIALS_JSON not set. Calendar sync disabled.");
      return null;
    }
    const credentials = JSON.parse(raw);
    auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    calendar = google.calendar({ version: "v3", auth });
    return calendar;
  } catch (err) {
    console.error("[Google] Failed to initialize Google Calendar client:", err.message);
    return null;
  }
}

// The timezone for Google Calendar events. Configurable via env, defaults to UTC.
const CALENDAR_TZ = process.env.GOOGLE_CALENDAR_TZ || "UTC";

// Helper to get YYYY-MM-DD for all-day events, adjusted by timezone offset
function getSafeDateStr(d, tzOffsetHours = 0) {
  const tzDate = new Date(d.getTime() + tzOffsetHours * 60 * 60 * 1000);
  const year = tzDate.getUTCFullYear();
  const month = String(tzDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(tzDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function addEventToGoogle(eventData) {
  const resolved = await resolveClient(eventData);
  if (!resolved) return null;
  const client = resolved.client;
  try {
    const mainCalendarId = resolved.calendarId;
    if (!mainCalendarId) {
      console.warn("[Google] GOOGLE_CALENDAR_ID not set. Skipping event creation.");
      return null;
    }

    const start = new Date(eventData.startDate);
    const end = new Date(eventData.endDate);

    const resource = {
      summary: eventData.title,
      description: eventData.description,
    };

    if (eventData.isAllDay) {
      const offsetHours = parseInt(process.env.GOOGLE_TZ_OFFSET_HOURS || "0", 10);
      const nextDay = new Date(end);
      nextDay.setDate(nextDay.getDate() + 1);

      resource.start = { date: getSafeDateStr(start, offsetHours) };
      resource.end = { date: getSafeDateStr(nextDay, offsetHours) };
    } else {
      const isMultiDay = end.getTime() - start.getTime() > 24 * 60 * 60 * 1000;
      const firstDayEnd = new Date(start);
      firstDayEnd.setUTCHours(end.getUTCHours(), end.getUTCMinutes(), 0, 0);

      if (firstDayEnd <= start) firstDayEnd.setUTCDate(firstDayEnd.getUTCDate() + 1);

      resource.start = { dateTime: start.toISOString(), timeZone: CALENDAR_TZ };
      resource.end = {
        dateTime: isMultiDay ? firstDayEnd.toISOString() : end.toISOString(),
        timeZone: CALENDAR_TZ,
      };

      if (isMultiDay) {
        const untilDate = new Date(end);
        untilDate.setUTCHours(23, 59, 59, 0);
        const untilStr = untilDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
        resource.recurrence = [`RRULE:FREQ=DAILY;UNTIL=${untilStr}`];
      }
    }

    let mainEventId = null;
    const inserted = [];
    try {
      const mainResponse = await client.events.insert({
        calendarId: mainCalendarId,
        resource: resource,
      });
      mainEventId = mainResponse.data.id;
      inserted.push({ calendarId: mainCalendarId, eventId: mainEventId });
      console.log("✅ Event added to MAIN Calendar:", mainResponse.data.htmlLink);
    } catch (mainErr) {
      console.error("❌ Failed to add to MAIN Calendar:", mainErr.message);
      return null;
    }

    if (eventData.targetEmails && eventData.targetEmails.length > 0) {
      for (const email of eventData.targetEmails) {
        try {
          const copyRes = await client.events.insert({
            calendarId: email,
            resource: resource,
          });
          inserted.push({ calendarId: email, eventId: copyRes.data.id });
          console.log(`✅ Event copied to Employee Calendar (${email})`);
        } catch (empErr) {
          console.log(`⚠️ Copy to ${email} skipped (Needs Calendar Permission).`);
        }
      }
    }

    return { id: mainEventId, inserted };
  } catch (error) {
    console.error("❌ Error in addEventToGoogle:", error.message);
    return null;
  }
}

async function deleteEventFromGoogle(eventData) {
  const resolved = await resolveClient(eventData);
  if (!resolved) return 0;
  const client = resolved.client;
  try {
    const mainCalendarId = resolved.calendarId;
    if (!mainCalendarId) return 0;

    const calendarsToSearch = [mainCalendarId];
    if (eventData.targetEmails && eventData.targetEmails.length > 0) {
      calendarsToSearch.push(...eventData.targetEmails);
    }
    const startWindow = new Date(eventData.startDate);
    startWindow.setDate(startWindow.getDate() - 3);
    const endWindow = new Date(eventData.startDate);
    endWindow.setDate(endWindow.getDate() + 3);

    let deletedCount = 0;
    for (const calendarId of calendarsToSearch) {
      try {
        const response = await client.events.list({
          calendarId: calendarId,
          q: eventData.title,
          timeMin: startWindow.toISOString(),
          timeMax: endWindow.toISOString(),
          maxResults: 10,
          singleEvents: true,
        });
        const events = response.data.items || [];
        const exactMatch = events.find(
          (e) => e.summary && e.summary.trim() === eventData.title.trim()
        );
        if (exactMatch) {
          const masterEventId = exactMatch.id.split("_")[0];
          await client.events.delete({
            calendarId: calendarId,
            eventId: masterEventId,
          });
          deletedCount++;
          console.log(`🗑️ Deleted from Calendar (${calendarId})`);
        }
      } catch (err) {
        console.log(`⚠️ Could not delete from ${calendarId}: ${err.message}`);
      }
    }
    return deletedCount;
  } catch (error) {
    console.error("❌ Error in deleteEventFromGoogle:", error.message);
    return 0;
  }
}

async function syncEmailsToGoogle(emails) {
  const client = getClient();
  if (!client) return 0;

  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return 0;

    let addedCount = 0;
    for (const email of emails) {
      try {
        await client.acl.insert({
          calendarId: calendarId,
          resource: { role: "reader", scope: { type: "user", value: email } },
        });
        addedCount++;
      } catch (err) {}
    }
    return addedCount;
  } catch (error) {
    return 0;
  }
}

async function deleteGoogleEventsByIds(inserted = []) {
  const client = getClient();
  if (!client) return 0;

  let deleted = 0;
  for (const item of inserted) {
    try {
      await client.events.delete({ calendarId: item.calendarId, eventId: item.eventId });
      deleted++;
    } catch (err) {
      console.log(`⚠️ Could not delete ${item.eventId} from ${item.calendarId}: ${err.message}`);
    }
  }
  return deleted;
}

module.exports = {
  addEventToGoogle,
  deleteEventFromGoogle,
  deleteGoogleEventsByIds,
  syncEmailsToGoogle,
};
