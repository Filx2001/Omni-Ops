// Appointments + Events → per-workspace "Schedule" sheet, mixed monthly tabs with a Type column.
const engine = require("./sheetEngine");

const HEADERS = [
  "Type",
  "Subject / Title",
  "Assignee(s)",
  "Date",
  "Day",
  "Time",
  "Location",
  "Record ID",
];

const apptLabel = (a) =>
  a.title ||
  `${a.assignee?.name || "TBA"} Appointment - ${new Date(a.startTime).getDate()}/${new Date(a.startTime).getMonth() + 1}`;

function apptPayload(a, tz) {
  return {
    Type: "Appointment",
    "Subject / Title": apptLabel(a),
    "Assignee(s)": a.assignee?.name || "TBA",
    Date: engine.fmtDate(a.startTime, tz),
    Day: a.day || engine.fmtDay(a.startTime, tz),
    Time: a.isAllDay
      ? "All day"
      : `${engine.fmtTime(a.startTime, tz)} - ${engine.fmtTime(a.endTime, tz)}`,
    Location: a.location || "TBA",
    "Record ID": a.id,
  };
}

// Multi-day events expand to one row per day (with a day suffix on the Record ID)
function eventPayloads(event, tz) {
  const typeLabel = event.type
    ? event.type.charAt(0).toUpperCase() + event.type.slice(1).replace("_", " ")
    : "Event";
  const names = (event.assignees || []).map((e) => e.name).join(", ") || "—";
  const days = [];
  const cur = new Date(event.startDate);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(event.endDate);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days.map((d) => ({
    Type: typeLabel,
    "Subject / Title": event.title || "Unknown",
    "Assignee(s)": names,
    Date: engine.fmtDate(d, tz),
    Day: engine.fmtDay(d, tz),
    Time: event.isAllDay
      ? "All day"
      : `${engine.fmtTime(event.startDate, tz)} - ${engine.fmtTime(event.endDate, tz)}`,
    Location: "—",
    "Record ID": days.length > 1 ? `${event.id}-${d.getDate()}` : event.id,
    __month: engine.monthTitle(d, tz),
  }));
}

// Upsert one record: delete stale rows, update matches, add missing (manual tabs untouched)
async function upsertRecord(doc, owns, wanted) {
  const existing = [];
  for (const sheet of doc.sheetsByIndex) {
    let rows = [];
    try {
      rows = await sheet.getRows();
    } catch {
      continue;
    }
    for (const row of rows) {
      const id = row.get("Record ID") || "";
      if (id && owns(id)) existing.push({ sheet, row, id });
    }
  }
  const wantedKeys = new Set(wanted.map((w) => `${w.month}::${w.payload["Record ID"]}`));
  for (const { sheet, row, id } of existing) {
    if (!wantedKeys.has(`${sheet.title}::${id}`)) await row.delete();
  }
  for (const w of wanted) {
    const match = existing.find(
      (e) => e.sheet.title === w.month && e.id === w.payload["Record ID"] && !e.row.deleted
    );
    if (match) {
      match.row.assign(w.payload);
      await match.row.save();
    } else {
      const sheet = await engine.getOrCreateTab(doc, w.month, HEADERS);
      await sheet.addRow(w.payload);
    }
  }
}

async function syncAppointmentToScheduleSheet(appt) {
  if (!appt?.id) return;
  try {
    const ctx = await engine.getSheetContext(appt.workspaceId, "googleScheduleSheetId");
    if (!ctx) return;
    const tz = ctx.ws.timezone;
    await engine.withDoc(appt.workspaceId, ctx.ws.googleScheduleSheetId, async (doc) => {
      await upsertRecord(doc, (id) => id === appt.id, [
        { month: engine.monthTitle(appt.startTime, tz), payload: apptPayload(appt, tz) },
      ]);
    });
  } catch (err) {
    console.error("[Schedule] appt sync failed:", err.message);
  }
}

async function syncEventToScheduleSheet(event) {
  if (!event?.id) return;
  try {
    const ctx = await engine.getSheetContext(event.workspaceId, "googleScheduleSheetId");
    if (!ctx) return;
    const tz = ctx.ws.timezone;
    await engine.withDoc(event.workspaceId, ctx.ws.googleScheduleSheetId, async (doc) => {
      const wanted = eventPayloads(event, tz).map((p) => {
        const { __month, ...payload } = p;
        return { month: __month, payload };
      });
      await upsertRecord(doc, (id) => id === event.id || id.startsWith(`${event.id}-`), wanted);
    });
  } catch (err) {
    console.error("[Schedule] event sync failed:", err.message);
  }
}

async function removeRecordFromScheduleSheet(id) {
  if (!id) return 0;
  try {
    const prisma = require("../prisma");
    const appt = await prisma.appointment.findUnique({ where: { id } });
    const event = appt ? null : await prisma.event.findUnique({ where: { id } });
    const wsId = appt?.workspaceId || event?.workspaceId;
    if (!wsId) return 0;
    const ctx = await engine.getSheetContext(wsId, "googleScheduleSheetId");
    if (!ctx) return 0;
    let deleted = 0;
    await engine.withDoc(wsId, ctx.ws.googleScheduleSheetId, async (doc) => {
      for (const sheet of doc.sheetsByIndex) {
        let rows = [];
        try {
          rows = await sheet.getRows();
        } catch {
          continue;
        }
        for (const row of rows) {
          const rid = row.get("Record ID") || "";
          if (rid === id || rid.startsWith(`${id}-`)) {
            await row.delete();
            deleted++;
          }
        }
      }
    });
    return deleted;
  } catch (err) {
    console.error("[Schedule] remove failed:", err.message);
    return 0;
  }
}

async function backfillScheduleSheet(appointments, events) {
  const wsId = appointments[0]?.workspaceId || events[0]?.workspaceId;
  if (!wsId) return 0;
  const ctx = await engine.getSheetContext(wsId, "googleScheduleSheetId");
  if (!ctx) return 0;
  const tz = ctx.ws.timezone;
  let rowsWritten = 0;
  await engine.withDoc(wsId, ctx.ws.googleScheduleSheetId, async (doc) => {
    const groups = new Map();
    const push = (title, payload) => {
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(payload);
    };
    for (const a of appointments) push(engine.monthTitle(a.startTime, tz), apptPayload(a, tz));
    for (const e of events)
      for (const p of eventPayloads(e, tz)) {
        const { __month, ...payload } = p;
        push(__month, payload);
      }

    for (const [title, rows] of groups) {
      const sheet = await engine.getOrCreateTab(doc, title, HEADERS);
      await sheet.setHeaderRow(HEADERS);
      await sheet.clearRows().catch(() => {});
      if (rows.length) await sheet.addRows(rows);
      rowsWritten += rows.length;
    }
    for (const sheet of doc.sheetsByIndex) {
      if (groups.has(sheet.title) || !engine.isMonthTab(sheet.title)) continue;
      await sheet.clearRows().catch(() => {});
    }
  });
  return rowsWritten;
}

module.exports = {
  syncAppointmentToScheduleSheet,
  syncEventToScheduleSheet,
  removeRecordFromScheduleSheet,
  backfillScheduleSheet,
};
