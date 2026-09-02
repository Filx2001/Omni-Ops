const prisma = require("../../prisma");
const { logAction } = require("../../services/audit/audit.service");
const { addEventToGoogle, deleteEventFromGoogle } = require("../../integrations/googleCalendar");
const {
  syncPersonalTask,
  removePersonalTask,
  isPersonalTask,
} = require("../../integrations/personalTasksSheet");

// Personal tasks (manager assigned to themselves) go to a private calendar
const calFor = (task) =>
  isPersonalTask(task) ? process.env.PERSONAL_TASKS_CALENDAR_ID || undefined : undefined;

const INCLUDE = { assignedTo: true, createdBy: true };

async function createTask(workspace, data) {
  const task = await prisma.task.create({
    data: { ...data, workspaceId: workspace.id },
    include: INCLUDE,
  });

  const personal = isPersonalTask(task);
  const validEmails = [];
  // Don't copy personal tasks into the employee's calendar — they'd see it twice
  if (!personal && task.assignedTo?.email && task.assignedTo.email.includes("@")) {
    validEmails.push(task.assignedTo.email);
  }

  if (task.dueDate) {
    try {
      await addEventToGoogle({
        title: `${task.assignedTo?.name || "Unassigned"} - 📋 Task: ${task.title}`,
        description: `👤 Assigned To: ${task.assignedTo?.name || "Unknown"}\n🔥 Priority: ${task.priority}\n📄 ${task.description || "No description"}`,
        startDate: task.dueDate,
        endDate: task.dueDate,
        isAllDay: true,
        targetEmails: validEmails,
        calendarId: calFor(task),
        workspaceId: workspace.id,
      });
    } catch (error) {
      console.error("[Google] Task event sync failed:", error.message);
    }
  }

  await logAction({
    workspaceId: workspace.id,
    action: "TASK_CREATED",
    entityType: "task",
    entityId: task.id,
    newValue: task,
  });

  syncPersonalTask(task).catch(() => {});
  return task;
}

async function updateTaskStatus(workspace, id, status) {
  const oldTask = await prisma.task.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignedTo: true },
  });
  if (!oldTask) throw new Error("Task not found.");

  let endOfDueDate = null;
  if (oldTask.dueDate) {
    endOfDueDate = new Date(oldTask.dueDate);
    endOfDueDate.setHours(23, 59, 59, 999);
  }

  if (
    status !== "done" &&
    endOfDueDate &&
    new Date() > endOfDueDate &&
    !["done", "cancelled"].includes(oldTask.status)
  ) {
    throw new Error("Task is overdue and locked.");
  }

  const completedAt = status === "done" ? new Date() : null;
  const daysLate =
    status === "done" && endOfDueDate && completedAt > endOfDueDate
      ? Math.ceil((completedAt - endOfDueDate) / (1000 * 60 * 60 * 24))
      : 0;

  const task = await prisma.task.update({
    where: { id },
    data: { status, completedAt, completedLate: daysLate > 0, daysLate },
  });

  if (oldTask.dueDate && (status === "done" || status === "cancelled")) {
    try {
      await deleteEventFromGoogle({
        title: `${oldTask.assignedTo?.name || "Unassigned"} - 📋 Task: ${oldTask.title}`,
        startDate: oldTask.dueDate,
        targetEmails: oldTask.assignedTo?.email ? [oldTask.assignedTo.email] : [],
        calendarId: calFor(oldTask),
        workspaceId: workspace.id,
      });
    } catch (error) {}
  }

  await logAction({
    workspaceId: workspace.id,
    action: "TASK_STATUS_UPDATED",
    entityType: "task",
    entityId: task.id,
    oldValue: oldTask,
    newValue: task,
  });

  syncPersonalTask({ ...oldTask, ...task }).catch(() => {});
  return task;
}

async function deleteTask(workspace, id) {
  const task = await prisma.task.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignedTo: true },
  });
  if (!task) throw new Error("Task not found.");

  if (task.dueDate && !["done", "cancelled"].includes(task.status)) {
    try {
      await deleteEventFromGoogle({
        title: `${task.assignedTo?.name || "Unassigned"} - 📋 Task: ${task.title}`,
        startDate: task.dueDate,
        targetEmails: task.assignedTo?.email ? [task.assignedTo.email] : [],
        calendarId: calFor(task),
        workspaceId: workspace.id,
      });
    } catch (error) {}
  }

  await logAction({
    workspaceId: workspace.id,
    action: "TASK_DELETED",
    entityType: "task",
    entityId: task.id,
    oldValue: task,
  });

  const deleted = await prisma.task.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
    include: INCLUDE,
  });

  removePersonalTask(id).catch(() => {});
  return deleted;
}

async function updateTask(workspace, id, data) {
  const oldTask = await prisma.task.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignedTo: true },
  });
  if (!oldTask) throw new Error("Task not found.");

  if (oldTask.dueDate && !["done", "cancelled"].includes(oldTask.status)) {
    try {
      await deleteEventFromGoogle({
        title: `${oldTask.assignedTo?.name || "Unassigned"} - 📋 Task: ${oldTask.title}`,
        startDate: oldTask.dueDate,
        targetEmails: oldTask.assignedTo?.email ? [oldTask.assignedTo.email] : [],
        calendarId: calFor(oldTask),
        workspaceId: workspace.id,
      });
    } catch (error) {}
  }

  const task = await prisma.task.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  const personal = isPersonalTask(task);
  const validEmails = [];
  if (!personal && task.assignedTo?.email && task.assignedTo.email.includes("@")) {
    validEmails.push(task.assignedTo.email);
  }

  if (task.dueDate && !["done", "cancelled"].includes(task.status)) {
    try {
      await addEventToGoogle({
        title: `${task.assignedTo?.name || "Unassigned"} - 📋 Task: ${task.title}`,
        description: `👤 Assigned To: ${task.assignedTo?.name || "Unknown"}\n🔥 Priority: ${task.priority}\n📄 ${task.description || "No description"}`,
        startDate: task.dueDate,
        endDate: task.dueDate,
        isAllDay: true,
        targetEmails: validEmails,
        calendarId: calFor(task),
        workspaceId: workspace.id,
      });
    } catch (error) {}
  }

  await logAction({
    workspaceId: workspace.id,
    action: "TASK_UPDATED",
    entityType: "task",
    entityId: task.id,
    oldValue: oldTask,
    newValue: task,
  });

  syncPersonalTask(task).catch(() => {});
  return task;
}

async function getTasksByEmployee(workspace, employeeId) {
  return prisma.task.findMany({
    where: {
      workspaceId: workspace.id,
      assignedToId: employeeId,
      isDeleted: false,
      isArchived: false,
    },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

async function getTasks(workspace) {
  return prisma.task.findMany({
    where: { workspaceId: workspace.id, isDeleted: false, isArchived: false },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

async function getTaskAuditHistory(taskId) {
  const { getTaskHistory } = require("../../services/audit/audit.service");
  return getTaskHistory(taskId);
}

module.exports = {
  createTask,
  getTasks,
  updateTask,
  updateTaskStatus,
  getTasksByEmployee,
  getTaskAuditHistory,
  deleteTask,
};
