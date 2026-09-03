const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { notifyReminder } = require("../utils/dmNotifier");
const { runWithTenant } = require("../utils/tenantContext");

/**
 * 30-minute reminder window.
 *
 * We send when the item is:
 * - 30 minutes or less away
 * - but not more than 5 minutes past due
 *
 * This protects against:
 * - cron drift
 * - Railway restarts
 * - missed exact-minute checks
 */
const REMINDER_WINDOW_MAX_MINUTES = 30;
const REMINDER_WINDOW_MIN_MINUTES = -5;

function shouldSendReminder(dateValue) {
  if (!dateValue) return false;

  const targetTime = new Date(dateValue).getTime();

  if (Number.isNaN(targetTime)) return false;

  const diffInMinutes = Math.floor((targetTime - Date.now()) / 60000);

  return (
    diffInMinutes <= REMINDER_WINDOW_MAX_MINUTES && diffInMinutes >= REMINDER_WINDOW_MIN_MINUTES
  );
}

function startScheduler(client) {
  cron.schedule("* * * * *", async () => {
    try {
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        await runWithTenant(ws.workspaceId, async () => {
          try {
            const pendingRes = await axios.get("/reminders/pending").catch(() => ({ data: {} }));

            const { tasks = [], appointments = [], events = [] } = pendingRes.data || {};

            const sent = {
              taskIds: [],
              appointmentIds: [],
              eventIds: [],
            };

            /**
             * TASK REMINDERS
             */
            for (const task of tasks) {
              if (!task?.dueDate) continue;
              if (!task?.assignedTo?.externalId) continue;
              if (!shouldSendReminder(task.dueDate)) continue;

              try {
                const result = await notifyReminder(
                  client,
                  task.assignedTo.externalId,
                  "Task",
                  task,
                  "30 minutes"
                );

                if (result !== false) {
                  sent.taskIds.push(task.id);
                }
              } catch (error) {
                console.error(`❌ Task reminder failed for task ${task.id}:`, error.message);
              }
            }

            /**
             * APPOINTMENT REMINDERS
             */
            for (const appointment of appointments) {
              if (!appointment?.startTime) continue;
              if (!appointment?.assignee?.externalId) continue;
              if (!shouldSendReminder(appointment.startTime)) continue;

              try {
                const result = await notifyReminder(
                  client,
                  appointment.assignee.externalId,
                  "Appointment",
                  appointment,
                  "30 minutes"
                );

                if (result !== false) {
                  sent.appointmentIds.push(appointment.id);
                }
              } catch (error) {
                console.error(
                  `❌ Appointment reminder failed for appointment ${appointment.id}:`,
                  error.message
                );
              }
            }

            /**
             * EVENT REMINDERS
             */
            for (const event of events) {
              if (!event?.startDate) continue;
              if (!shouldSendReminder(event.startDate)) continue;

              const targets = (event.assignees || []).filter(
                (assignee) => assignee?.externalId && assignee.reminderEnabled !== false
              );

              if (!targets.length) {
                sent.eventIds.push(event.id);
                continue;
              }

              let anySuccess = false;

              for (const target of targets) {
                try {
                  const result = await notifyReminder(
                    client,
                    target.externalId,
                    "Event",
                    event,
                    "30 minutes"
                  );

                  if (result !== false) {
                    anySuccess = true;
                  }
                } catch (error) {
                  console.error(`❌ Event reminder failed for event ${event.id}:`, error.message);
                }
              }

              if (anySuccess) {
                sent.eventIds.push(event.id);
              }
            }

            /**
             * MARK SENT IN DATABASE
             */
            if (sent.taskIds.length || sent.appointmentIds.length || sent.eventIds.length) {
              await axios.post("/reminders/mark-sent", sent).catch((error) => {
                console.error(
                  `❌ Failed to mark reminders as sent for workspace ${ws.workspaceId}:`,
                  error.message
                );
              });
            }
          } catch (error) {
            console.error(`❌ Scheduler Error for workspace ${ws.workspaceId}:`, error.message);
          }
        });
      }
    } catch (error) {
      console.error("❌ Scheduler Core Error:", error.message);
    }
  });

  console.log("✅ Global Scheduler Engine started!");
}

module.exports = { startScheduler };
