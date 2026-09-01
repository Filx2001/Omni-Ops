const googleAuth = require("./googleAuth");

const sheetId = (ws) => ws?.googleAccountingSheetId || process.env.ACCOUNTING_SHEET_ID;
const apptRow = (a) => [
  a.id,
  a.title || "",
  a.assignee?.name || "",
  a.day || "",
  a.startTime ? new Date(a.startTime).toISOString() : "",
  a.endTime ? new Date(a.endTime).toISOString() : "",
  a.location || "",
];
const eventRow = (e) => [
  e.id,
  e.title || "",
  e.type || "",
  e.startDate ? new Date(e.startDate).toISOString() : "",
  e.endDate ? new Date(e.endDate).toISOString() : "",
];

async function append(workspaceId, tab, row) {
  const ctx = await googleAuth.getAuthForWorkspace(workspaceId);
  const id = sheetId(ctx?.ws);
  if (!ctx?.auth || !id) return;
  await googleAuth.appendRow(ctx.auth, id, tab, row);
}

async function syncAppointmentToAccountingSheet(appt) {
  try {
    await append(appt.workspaceId, "Appointments", apptRow(appt));
  } catch (e) {
    console.error("[Accounting] appt sync failed:", e.message);
  }
}
const syncClassToAccountingSheet = syncAppointmentToAccountingSheet;

async function syncEventToAccountingSheet(event) {
  try {
    await append(event.workspaceId, "Events", eventRow(event));
  } catch (e) {
    console.error("[Accounting] event sync failed:", e.message);
  }
}

async function removeRecordFromAccountingSheet(id) {
  try {
    const prisma = require("../prisma");
    // find the workspace that owns this record (appointment or event)
    const appt = await prisma.appointment.findUnique({ where: { id } });
    const event = appt ? null : await prisma.event.findUnique({ where: { id } });
    const wsId = appt?.workspaceId || event?.workspaceId;
    if (!wsId) return 0;
    const ctx = await googleAuth.getAuthForWorkspace(wsId);
    const sid = sheetId(ctx?.ws);
    if (!ctx?.auth || !sid) return 0;
    const a = await googleAuth.deleteRowByValue(ctx.auth, sid, "Appointments", 0, id);
    const b = a ? 0 : await googleAuth.deleteRowByValue(ctx.auth, sid, "Events", 0, id);
    return (a ? 1 : 0) + b;
  } catch (e) {
    console.error("[Accounting] remove failed:", e.message);
    return 0;
  }
}

async function backfillAccountingSheet(classes, events) {
  try {
    const wsId = classes[0]?.workspaceId || events[0]?.workspaceId;
    const ctx = await googleAuth.getAuthForWorkspace(wsId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return 0;
    await googleAuth.rewriteTab(ctx.auth, id, "Appointments", [
      googleAuth.APPT_HEADER,
      ...classes.map(apptRow),
    ]);
    await googleAuth.rewriteTab(ctx.auth, id, "Events", [
      googleAuth.EVENT_HEADER,
      ...events.map(eventRow),
    ]);
    return classes.length + events.length;
  } catch (e) {
    console.error("[Accounting] backfill failed:", e.message);
    return 0;
  }
}

module.exports = {
  syncClassToAccountingSheet,
  syncAppointmentToAccountingSheet,
  syncEventToAccountingSheet,
  removeRecordFromAccountingSheet,
  backfillAccountingSheet,
};
