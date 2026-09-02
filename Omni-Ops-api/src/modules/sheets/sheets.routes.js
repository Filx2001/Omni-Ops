const router = require("express").Router();
const prisma = require("../../prisma");
const { rebuildLeadsSheet } = require("../../integrations/googleSheets");
const { backfillScheduleSheet } = require("../../integrations/scheduleSheets");
const { backfillAccountingSheet } = require("../../integrations/accountingSheets");
const { rebuildPersonalTasksSheet } = require("../../integrations/personalTasksSheet");

// POST /sheets/sync  — body: { targets: ["leads","schedule","accounting","personal"] } or [] = ALL
router.post("/sync", async (req, res, next) => {
  try {
    const ws = req.workspace;
    const { targets } = req.body || {};
    const want = (t) => !targets?.length || targets.includes(t);
    const results = {};

    if (want("leads")) {
      const leads = await prisma.lead.findMany({
        where: { workspaceId: ws.id },
        include: { assignedTo: true },
        orderBy: { createdAt: "asc" },
      });
      results.leads = await rebuildLeadsSheet(leads);
    }

    if (want("schedule")) {
      const appointments = await prisma.appointment.findMany({
        where: { workspaceId: ws.id },
        include: { assignee: true },
      });
      const events = await prisma.event.findMany({
        where: { workspaceId: ws.id },
        include: { assignees: true },
      });
      results.schedule = await backfillScheduleSheet(appointments, events);
    }

    if (want("accounting")) {
      const invoices = await prisma.invoice.findMany({
        where: { workspaceId: ws.id },
        orderBy: { createdAt: "asc" },
      });
      results.accounting = await backfillAccountingSheet(invoices);
    }

    if (want("personal")) {
      const tasks = await prisma.task.findMany({
        where: { workspaceId: ws.id },
        include: { assignedTo: true, createdBy: true },
      });
      results.personal = await rebuildPersonalTasksSheet(tasks);
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
