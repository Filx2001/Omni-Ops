const prisma = require("../../prisma");
const { logAction, getTaskHistory } = require("../../services/audit/audit.service");
const { addEventToGoogle, deleteEventFromGoogle } = require("../../utils/googleCalendar");
const {
  syncPersonalTask,
  removePersonalTask,
  isPersonalTask,
} = require("../../utils/personalTasksSheet");
// التاسك الشخصية بتروح لكالندر منفصل — undefined معناها الكالندر العام
const calFor = (task) =>
  isPersonalTask(task) ? process.env.PERSONAL_TASKS_CALENDAR_ID || undefined : undefined;
async function createTask(data) {
  const task = await prisma.task.create({
    data,
    include: { assignedTo: true, createdBy: true },
  });
  const personal = isPersonalTask(task);
  const validEmails = [];
  // مش بننسخ لكالندر الموظف في التاسك الشخصية — هتظهر مرتين عندها
  if (!personal && task.assignedTo?.email && task.assignedTo.email.includes("@")) {
    validEmails.push(task.assignedTo.email);
  }
  if (task.dueDate) {
    try {
      await addEventToGoogle({
        // 🌟 التعديل هنا: طباعة اسم الموظف في العنوان
        title: `${task.assignedTo?.name || "Unassigned"} - 📋 Task: ${task.title}`,
        description: `👤 Assigned To: ${task.assignedTo?.name || "Unknown"}\n🔥 Priority: ${task.priority}\n📄 ${task.description || "No description"}`,
        startDate: task.dueDate,
        endDate: task.dueDate,
        isAllDay: true,
        targetEmails: validEmails,
        calendarId: calFor(task),
      });
    } catch (error) {}
  }
  await logAction({
    action: "TASK_CREATED",
    entityType: "task",
    entityId: task.id,
    newValue: task,
  });
  // التاسكات الشخصية بس هي اللي بتروح للشيت الخاص
  syncPersonalTask(task).catch(() => {});
  return task;
}

async function updateTaskStatus(id, status) {
  const oldTask = await prisma.task.findUnique({ where: { id }, include: { assignedTo: true } });
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
        // 🌟 التعديل في الحذف عشان يلاقيه بالاسم الجديد
        title: `${oldTask.assignedTo?.name || "Unassigned"} - 📋 Task: ${oldTask.title}`,
        startDate: oldTask.dueDate,
        targetEmails: oldTask.assignedTo?.email ? [oldTask.assignedTo.email] : [],
        calendarId: calFor(oldTask),
      });
    } catch (error) {}
  }

  await logAction({
    action: "TASK_STATUS_UPDATED",
    entityType: "task",
    entityId: task.id,
    oldValue: oldTask,
    newValue: task,
  });
  syncPersonalTask({ ...oldTask, ...task }).catch(() => {});
  return task;
}

async function deleteTask(id) {
  const task = await prisma.task.findUnique({ where: { id }, include: { assignedTo: true } });
  if (!task) throw new Error("Task not found.");

  if (task.dueDate && !["done", "cancelled"].includes(task.status)) {
    try {
      await deleteEventFromGoogle({
        // 🌟 التعديل في الحذف
        title: `${task.assignedTo?.name || "Unassigned"} - 📋 Task: ${task.title}`,
        startDate: task.dueDate,
        targetEmails: task.assignedTo?.email ? [task.assignedTo.email] : [],
        calendarId: calFor(task),
      });
    } catch (error) {}
  }

  await logAction({
    action: "TASK_DELETED",
    entityType: "task",
    entityId: task.id,
    oldValue: task,
  });
  const deleted = await prisma.task.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
    include: { assignedTo: true, createdBy: true },
  });
  removePersonalTask(id).catch(() => {});
  return deleted;
}

async function updateTask(id, data) {
  const oldTask = await prisma.task.findUnique({ where: { id }, include: { assignedTo: true } });
  if (!oldTask) throw new Error("Task not found.");

  if (oldTask.dueDate && !["done", "cancelled"].includes(oldTask.status)) {
    try {
      await deleteEventFromGoogle({
        title: `${oldTask.assignedTo?.name || "Unassigned"} - 📋 Task: ${oldTask.title}`,
        startDate: oldTask.dueDate,
        targetEmails: oldTask.assignedTo?.email ? [oldTask.assignedTo.email] : [],
        calendarId: calFor(oldTask),
      });
    } catch (error) {}
  }

  const task = await prisma.task.update({
    where: { id },
    data,
    include: { assignedTo: true, createdBy: true },
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
      });
    } catch (error) {}
  }

  await logAction({
    action: "TASK_UPDATED",
    entityType: "task",
    entityId: task.id,
    oldValue: oldTask,
    newValue: task,
  });
  // لو المكلَّف اتغير لحد تاني، الدالة بتشيل الصف من الشيت لوحدها
  syncPersonalTask(task).catch(() => {});
  return task;
}

async function getTasksByEmployee(employeeId) {
  return prisma.task.findMany({
    where: { assignedToId: employeeId, isDeleted: false, isArchived: false },
    include: { assignedTo: true, createdBy: true },
    orderBy: { createdAt: "desc" },
  });
}
async function getTasks() {
  return prisma.task.findMany({
    where: { isDeleted: false, isArchived: false },
    include: { assignedTo: true, createdBy: true },
    orderBy: { createdAt: "desc" },
  });
}
async function getTaskAuditHistory(taskId) {
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
