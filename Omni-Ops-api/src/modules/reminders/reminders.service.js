const prisma = require("../../prisma");

const LOOKBACK_MINUTES = 10;
const STANDARD_LOOKAHEAD_MINUTES = 45;

function customMinutesFor(employee) {
  if (!employee) return null;
  if (employee.reminderUnit === "hours") return employee.reminderValue * 60;
  if (employee.reminderUnit === "days") return employee.reminderValue * 1440;
  return null;
}

function ids(list) {
  return Array.isArray(list) ? list : [];
}

async function getPendingReminders(workspace) {
  const now = new Date();

  const employees = await prisma.employee.findMany({
    where: {
      workspaceId: workspace.id,
      reminderEnabled: true,
      externalId: { not: null },
    },
  });

  if (!employees.length) {
    return { tasks: [], appointments: [], events: [] };
  }

  const employeeIds = employees.map((e) => e.id);

  let maxCustomMinutes = 0;
  for (const employee of employees) {
    const minutes = customMinutesFor(employee);
    if (minutes && minutes > maxCustomMinutes) maxCustomMinutes = minutes;
  }

  const windowStart = new Date(now.getTime() - LOOKBACK_MINUTES * 60000);
  const windowEnd = new Date(
    now.getTime() + Math.max(maxCustomMinutes, STANDARD_LOOKAHEAD_MINUTES) * 60000
  );

  const [tasks, appointments, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId: workspace.id,
        isDeleted: false,
        isArchived: false,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { gte: windowStart, lte: windowEnd },
        assignedToId: { in: employeeIds },
        OR: [{ reminderSent: false }, { customReminderSent: false }],
      },
      include: { assignedTo: true },
    }),

    prisma.appointment.findMany({
      where: {
        workspaceId: workspace.id,
        isAllDay: false,
        startTime: { gte: windowStart, lte: windowEnd },
        assigneeId: { in: employeeIds },
        OR: [{ reminderSent: false }, { customReminderSent: false }],
      },
      include: { assignee: true },
    }),

    prisma.event.findMany({
      where: {
        workspaceId: workspace.id,
        isAllDay: false,
        startDate: { gte: windowStart, lte: windowEnd },
        reminderSent: false,
        assignees: { some: { id: { in: employeeIds } } },
      },
      include: { assignees: true },
    }),
  ]);

  return { tasks, appointments, events };
}

async function markRemindersSent(workspace, body = {}) {
  const standard = body.standard || {};
  const custom = body.custom || {};

  await Promise.all([
    ids(standard.taskIds).length
      ? prisma.task.updateMany({
          where: { workspaceId: workspace.id, id: { in: ids(standard.taskIds) } },
          data: { reminderSent: true },
        })
      : Promise.resolve(),

    ids(standard.appointmentIds).length
      ? prisma.appointment.updateMany({
          where: { workspaceId: workspace.id, id: { in: ids(standard.appointmentIds) } },
          data: { reminderSent: true },
        })
      : Promise.resolve(),

    ids(standard.eventIds).length
      ? prisma.event.updateMany({
          where: { workspaceId: workspace.id, id: { in: ids(standard.eventIds) } },
          data: { reminderSent: true },
        })
      : Promise.resolve(),

    ids(custom.taskIds).length
      ? prisma.task.updateMany({
          where: { workspaceId: workspace.id, id: { in: ids(custom.taskIds) } },
          data: { customReminderSent: true },
        })
      : Promise.resolve(),

    ids(custom.appointmentIds).length
      ? prisma.appointment.updateMany({
          where: { workspaceId: workspace.id, id: { in: ids(custom.appointmentIds) } },
          data: { customReminderSent: true },
        })
      : Promise.resolve(),
  ]);

  return { ok: true };
}

module.exports = {
  getPendingReminders,
  markRemindersSent,
};
