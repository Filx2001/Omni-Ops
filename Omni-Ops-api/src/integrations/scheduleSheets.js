const googleAuth = require("./googleAuth");

const sheetId = (ws) => ws?.googleScheduleSheetId;
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

// Self-healing: workspaces connected BEFORE this feature get their Schedule sheet on first use
async function ensureCtx(wsId) {
  let ctx = await googleAuth.getAuthForWorkspace(wsId);
  if (ctx?.ws && !ctx.ws.googleScheduleSheetId) {
    await googleAuth.provisionGoogleResources(wsId);
    ctx = await googleAuth.getAuthForWorkspace(wsId);
  }
  return ctx;
}

async function append(wsId, tab, row) {
  const ctx = await ensureCtx(wsId);
  const id = sheetId(ctx?.ws);
  if (!ctx?.auth || !id) return;
  await googleAuth.appendRow(ctx.auth, id, tab, row);
}

async function syncAppointmentToScheduleSheet(appt) {
  try {
    await append(appt.workspaceId, "Appointments", apptRow(appt));
  } catch (e) {
    console.error("[Schedule] appt sync failed:", e.message);
  }
}

async function syncEventToScheduleSheet(event) {
  try {
    await append(event.workspaceId, "Events", eventRow(event));
  } catch (e) {
    console.error("[Schedule] event sync failed:", e.message);
  }
}

async function removeRecordFromScheduleSheet(id) {
  try {
    const prisma = require("../prisma");
    const appt = await prisma.appointment.findUnique({ where: { id } });
    const event = appt ? null : await prisma.event.findUnique({ where: { id } });
    const wsId = appt?.workspaceId || event?.workspaceId;
    if (!wsId) return 0;
    const ctx = await ensureCtx(wsId);
    const sid = sheetId(ctx?.ws);
    if (!ctx?.auth || !sid) return 0;
    const a = await googleAuth.deleteRowByValue(ctx.auth, sid, "Appointments", 0, id);
    const b = a ? 0 : await googleAuth.deleteRowByValue(ctx.auth, sid, "Events", 0, id);
    return (a ? 1 : 0) + b;
  } catch (e) {
    console.error("[Schedule] remove failed:", e.message);
    return 0;
  }
}

async function backfillScheduleSheet(appointments, events) {
  try {
    const wsId = appointments[0]?.workspaceId || events[0]?.workspaceId;
    const ctx = await ensureCtx(wsId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return 0;
    await googleAuth.rewriteTab(ctx.auth, id, "Appointments", [
      googleAuth.APPT_HEADER,
      ...appointments.map(apptRow),
    ]);
    await googleAuth.rewriteTab(ctx.auth, id, "Events", [
      googleAuth.EVENT_HEADER,
      ...events.map(eventRow),
    ]);
    return appointments.length + events.length;
  } catch (e) {
    console.error("[Schedule] backfill failed:", e.message);
    return 0;
  }
}

module.exports = {
  syncAppointmentToScheduleSheet,
  syncEventToScheduleSheet,
  removeRecordFromScheduleSheet,
  backfillScheduleSheet,
};
