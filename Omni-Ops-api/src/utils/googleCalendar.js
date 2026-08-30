const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: "v3", auth });

async function addEventToGoogle(eventData) {
  try {
    // calendarId اختياري — التاسكات الشخصية بتروح لكالندر منفصل
    const mainCalendarId = eventData.calendarId || process.env.GOOGLE_CALENDAR_ID;
    const start = new Date(eventData.startDate);
    const end = new Date(eventData.endDate);

    const resource = {
      summary: eventData.title,
      description: eventData.description,
    };

    if (eventData.isAllDay) {
      const getSafeDateStr = (d) => {
        const tzDate = new Date(d.getTime() + 3 * 60 * 60 * 1000);
        const year = tzDate.getUTCFullYear();
        const month = String(tzDate.getUTCMonth() + 1).padStart(2, "0");
        const day = String(tzDate.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };
      const nextDay = new Date(end);
      nextDay.setDate(nextDay.getDate() + 1);

      resource.start = { date: getSafeDateStr(start) };
      resource.end = { date: getSafeDateStr(nextDay) };
    } else {
      const isMultiDay = end.getTime() - start.getTime() > 24 * 60 * 60 * 1000;
      const firstDayEnd = new Date(start);
      firstDayEnd.setUTCHours(end.getUTCHours(), end.getUTCMinutes(), 0, 0);

      if (firstDayEnd <= start) firstDayEnd.setUTCDate(firstDayEnd.getUTCDate() + 1);

      resource.start = { dateTime: start.toISOString(), timeZone: "Asia/Qatar" };
      resource.end = {
        dateTime: isMultiDay ? firstDayEnd.toISOString() : end.toISOString(),
        timeZone: "Asia/Qatar",
      };

      if (isMultiDay) {
        const untilDate = new Date(end);
        untilDate.setUTCHours(23, 59, 59, 0);
        const untilStr = untilDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
        resource.recurrence = [`RRULE:FREQ=DAILY;UNTIL=${untilStr}`];
      }
    }

    // 🌟 1. الرفع الأساسي للتقويم العام (عشان كل حاجة تبان للمديرة)
    let mainEventId = null;
    const inserted = [];
    try {
      const mainResponse = await calendar.events.insert({
        calendarId: mainCalendarId,
        resource: resource,
      });
      mainEventId = mainResponse.data.id;
      inserted.push({ calendarId: mainCalendarId, eventId: mainEventId });
      console.log("✅ Event added to MAIN Calendar:", mainResponse.data.htmlLink);
    } catch (mainErr) {
      console.error("❌ Failed to add to MAIN Calendar:", mainErr.message);
      return null; // لو فشل يرفع للعام، هيوقف عشان ميحصلش لغبطة
    }

    // 🌟 2. الرفع الموازي لتقويم الموظف (عشان يشوف تاسكاته وحصصه لوحده)
    if (eventData.targetEmails && eventData.targetEmails.length > 0) {
      for (const email of eventData.targetEmails) {
        try {
          const copyRes = await calendar.events.insert({
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
  try {
    // 🌟 بناء قائمة التقاويم للبحث
    const calendarsToSearch = [eventData.calendarId || process.env.GOOGLE_CALENDAR_ID];
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
        const response = await calendar.events.list({
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

          await calendar.events.delete({
            calendarId: calendarId,
            eventId: masterEventId,
          });
          deletedCount++;
          console.log(`🗑️ Deleted from Calendar (${calendarId})`);
        } else {
          console.log(`ℹ️ No matching event found in ${calendarId}`);
        }
      } catch (err) {
        console.log(`⚠️ Could not delete from ${calendarId}: ${err.message}`);
      }
    }
    console.log(`✅ Total events deleted: ${deletedCount}`);
    return deletedCount;
  } catch (error) {
    console.error("❌ Error in deleteEventFromGoogle:", error.message);
  }
}

async function syncEmailsToGoogle(emails) {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    let addedCount = 0;
    for (const email of emails) {
      try {
        await calendar.acl.insert({
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
// 🎯 مسح دقيق بالمعرفات المخزنة — مفيش بحث بالاسم ولا مسح بالغلط
async function deleteGoogleEventsByIds(inserted = []) {
  let deleted = 0;
  for (const item of inserted) {
    try {
      await calendar.events.delete({ calendarId: item.calendarId, eventId: item.eventId });
      deleted++;
    } catch (err) {
      console.log(`⚠️ Could not delete ${item.eventId} from ${item.calendarId}: ${err.message}`);
    }
  }
  console.log(`✅ Deleted ${deleted} Google event(s) by ID`);
  return deleted;
}
module.exports = {
  addEventToGoogle,
  deleteEventFromGoogle,
  deleteGoogleEventsByIds,
  syncEmailsToGoogle,
};
