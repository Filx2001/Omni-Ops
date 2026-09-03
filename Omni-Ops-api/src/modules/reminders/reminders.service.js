const prisma = require("../../prisma");

/**
 * Scheduler window:
 *
 * We fetch items that are due from 5 minutes in the past
 * until 45 minutes in the future.
 *
 * The bot then decides whether to send the actual 30-minute warning.
 */
const WINDOW_START_MINUTES = -5;
const WINDOW_END_MINUTES = 45;

function getWindowDates() {
  const now = new Date();

  return {
    start: new Date(now.getTime() + WINDOW_START_MINUTES * 60000),
    end: new Date(now.getTime() + WINDOW_END_MINUTES * 60000),
  };
}

async function getPendingReminders(workspace) {
  const { start, end } = getWindowDates();

  const [tasks, appointments, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId: workspace.id,
        isDeleted: false,
        isArchived: false,
        reminderSent: false,
        status: {
          notIn: ["done", "cancelled"],
        },
        dueDate: {
          gte: start,
          lte: end,
        },
        assignedTo: {
          reminderEnabled: true,
          externalId: {
            not: null,
          },
        },
      },
      include: {
        assignedTo: true,
      },
    }),

    prisma.appointment.findMany({
      where: {
        workspaceId: workspace.id,
        reminderSent: false,
        isAllDay: false,
        startTime: {
          gte: start,
          lte: end,
        },
        assignee: {
          reminderEnabled: true,
          externalId: {
            not: null,
          },
        },
      },
      include: {
        assignee: true,
      },
    }),

    prisma.event.findMany({
      where: {
        workspaceId: workspace.id,
        reminderSent: false,
        isAllDay: false,
        startDate: {
          gte: start,
          lte: end,
        },
        assignees: {
          some: {
            reminderEnabled: true,
            externalId: {
              not: null,
            },
          },
        },
      },
      include: {
        assignees: true,
      },
    }),
  ]);

  return {
    tasks,
    appointments,
    events,
  };
}

async function markRemindersSent(workspace, body = {}) {
  const taskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
  const appointmentIds = Array.isArray(body.appointmentIds) ? body.appointmentIds : [];
  const eventIds = Array.isArray(body.eventIds) ? body.eventIds : [];

  const [tasks, appointments, events] = await Promise.all([
    taskIds.length
      ? prisma.task.updateMany({
          where: {
            workspaceId: workspace.id,
            id: {
              in: taskIds,
            },
          },
          data: {
            reminderSent: true,
          },
        })
      : Promise.resolve(),

    appointmentIds.length
      ? prisma.appointment.updateMany({
          where: {
            workspaceId: workspace.id,
            id: {
              in: appointmentIds,
            },
          },
          data: {
            reminderSent: true,
          },
        })
      : Promise.resolve(),

    eventIds.length
      ? prisma.event.updateMany({
          where: {
            workspaceId: workspace.id,
            id: {
              in: eventIds,
            },
          },
          data: {
            reminderSent: true,
          },
        })
      : Promise.resolve(),
  ]);

  return {
    tasks,
    appointments,
    events,
  };
}

module.exports = {
  getPendingReminders,
  markRemindersSent,
};
