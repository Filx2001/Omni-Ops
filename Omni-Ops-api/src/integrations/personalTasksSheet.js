// Personal tasks (manager self-assigned) → per-worksheet "Personal Tasks" sheet, monthly tabs.
const engine = require("./sheetEngine");

const HEADERS = [
  "Task",
  "Priority",
  "Status",
  "Due Date",
  "Day",
  "Created At",
  "Completed At",
  "Description",
  "Record ID",
];
const PRIORITY_MAP = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const STATUS_MAP = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

const isPersonalTask = (task) =>
  Boolean(task?.assignedToId) && task.assignedToId === task.createdById;
const tabForTask = (task, tz) =>
  engine.monthTitle(task.dueDate || task.createdAt || Date.now(), tz);

function buildRowPayload(task, tz) {
  return {
    Task: task.title || "Untitled",
    Priority: PRIORITY_MAP[task.priority] || task.priority || "",
    Status: STATUS_MAP[task.status] || task.status || "",
    "Due Date": engine.fmtDate(task.dueDate, tz),
    Day: engine.fmtDay(task.dueDate, tz),
    "Created At": engine.fmtDateTime(task.createdAt, tz),
    "Completed At": engine.fmtDateTime(task.completedAt, tz),
    Description: task.description || "",
    "Record ID": task.id,
  };
}

async function findTaskRows(doc, taskId) {
  const found = [];
  for (const sheet of doc.sheetsByIndex) {
    let rows = [];
    try {
      rows = await sheet.getRows();
    } catch {
      continue;
    }
    for (const row of rows) if (row.get("Record ID") === taskId) found.push({ sheet, row });
  }
  return found;
}

async function syncPersonalTask(task) {
  if (!task?.id) return;
  try {
    const ctx = await engine.getSheetContext(task.workspaceId, "googlePersonalSheetId");
    if (!ctx) return;
    const tz = ctx.ws.timezone;
    await engine.withDoc(task.workspaceId, ctx.ws.googlePersonalSheetId, async (doc) => {
      const existing = await findTaskRows(doc, task.id);
      if (!isPersonalTask(task) || task.isDeleted) {
        for (const { row } of existing) await row.delete();
        return;
      }
      const title = tabForTask(task, tz);
      const payload = buildRowPayload(task, tz);
      let updated = false;
      for (const { sheet, row } of existing) {
        if (sheet.title === title && !updated) {
          row.assign(payload);
          await row.save();
          updated = true;
        } else await row.delete(); // dueDate changed month → row moves
      }
      if (!updated) {
        const sheet = await engine.getOrCreateTab(doc, title, HEADERS);
        await sheet.addRow(payload);
      }
    });
  } catch (err) {
    console.error("[PersonalTasks] sync failed:", err.message);
  }
}

async function removePersonalTask(taskId) {
  if (!taskId) return;
  try {
    const prisma = require("../prisma");
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return;
    const ctx = await engine.getSheetContext(task.workspaceId, "googlePersonalSheetId");
    if (!ctx) return;
    await engine.withDoc(task.workspaceId, ctx.ws.googlePersonalSheetId, async (doc) => {
      const existing = await findTaskRows(doc, taskId);
      for (const { row } of existing) await row.delete();
    });
  } catch (err) {
    console.error("[PersonalTasks] remove failed:", err.message);
  }
}

async function rebuildPersonalTasksSheet(tasks) {
  const stats = { tabs: 0, rows: 0, clearedTabs: 0 };
  const personal = (tasks || []).filter((t) => isPersonalTask(t) && !t.isDeleted);
  if (!personal.length) return stats;
  const wsId = personal[0].workspaceId;
  const ctx = await engine.getSheetContext(wsId, "googlePersonalSheetId");
  if (!ctx) return stats;
  const tz = ctx.ws.timezone;
  await engine.withDoc(wsId, ctx.ws.googlePersonalSheetId, async (doc) => {
    const groups = new Map();
    for (const task of personal) {
      const title = tabForTask(task, tz);
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(buildRowPayload(task, tz));
    }
    for (const [title, rows] of groups) {
      const sheet = await engine.getOrCreateTab(doc, title, HEADERS);
      await sheet.setHeaderRow(HEADERS);
      await sheet.clearRows().catch(() => {});
      if (rows.length) await sheet.addRows(rows);
      stats.tabs++;
      stats.rows += rows.length;
    }
    for (const sheet of doc.sheetsByIndex) {
      if (groups.has(sheet.title) || !engine.isMonthTab(sheet.title)) continue;
      await sheet.clearRows().catch(() => {});
      stats.clearedTabs++;
    }
  });
  return stats;
}

module.exports = {
  isPersonalTask,
  syncPersonalTask,
  removePersonalTask,
  rebuildPersonalTasksSheet,
};
