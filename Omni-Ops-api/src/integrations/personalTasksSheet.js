const prisma = require("../../prisma");
const googleAuth = require("./googleAuth");

function isPersonalTask(task) {
  return Boolean(task?.assignedToId) && task.assignedToId === task.createdById;
}

async function syncPersonalTask(task) {
  if (!isPersonalTask(task)) return;
  try {
    const ctx = await googleAuth.getAuthForWorkspace(task.workspaceId);
    const id = ctx?.ws?.googlePersonalSheetId || process.env.PERSONAL_TASKS_SHEET_ID;
    if (!ctx?.auth || !id) return;
    await googleAuth.appendRow(ctx.auth, id, "Tasks", [
      task.id,
      task.title || "",
      task.priority || "",
      task.dueDate ? new Date(task.dueDate).toISOString() : "",
      task.status || "",
    ]);
  } catch (e) {
    console.error("[PersonalSheet] sync failed:", e.message);
  }
}

async function removePersonalTask(taskId) {
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return;
    const ctx = await googleAuth.getAuthForWorkspace(task.workspaceId);
    const id = ctx?.ws?.googlePersonalSheetId || process.env.PERSONAL_TASKS_SHEET_ID;
    if (!ctx?.auth || !id) return;
    await googleAuth.deleteRowByValue(ctx.auth, id, "Tasks", 0, taskId);
  } catch (e) {
    console.error("[PersonalSheet] remove failed:", e.message);
  }
}

module.exports = { isPersonalTask, syncPersonalTask, removePersonalTask };
