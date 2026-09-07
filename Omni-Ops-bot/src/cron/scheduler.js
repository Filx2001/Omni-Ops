const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { notifyReminder } = require("../utils/dmNotifier");
const { runWithTenant } = require("../utils/tenantContext");

const STANDARD_MAX_MINUTES = 30;
const STANDARD_MIN_MINUTES = -5;
const CUSTOM_SLACK_MINUTES = 60;

function diffMinutes(dateValue) {
  const target = new Date(dateValue).getTime();
  if (Number.isNaN(target)) return null;
  return Math.floor((target - Date.now()) / 60000);
}

function inStandardWindow(dateValue) {
  const diff = diffMinutes(dateValue);
  return diff !== null && diff <= STANDARD_MAX_MINUTES && diff >= STANDARD_MIN_MINUTES;
}

function customMinutesFor(emp) {
  if (!emp) return null;
  if (emp.reminderUnit === "hours") return emp.reminderValue * 60;
  if (emp.reminderUnit === "days") return emp.reminderValue * 1440;
  return null;
}

function inCustomWindow(dateValue, customMinutes) {
  const diff = diffMinutes(dateValue);
  return diff !== null && diff <= customMinutes && diff >= customMinutes - CUSTOM_SLACK_MINUTES;
}

function emptySent() {
  return {
    standard: { taskIds: [], appointmentIds: [], eventIds: [] },
    custom: { taskIds: [], appointmentIds: [] },
  };
}

function hasSent(sent) {
  return Boolean(
    sent.standard.taskIds.length ||
    sent.standard.appointmentIds.length ||
    sent.standard.eventIds.length ||
    sent.custom.taskIds.length ||
    sent.custom.appointmentIds.length
  );
}

function startScheduler(client) {
  cron.schedule("* * * * *", async () => {
    try {
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        // 🔥 CRITICAL FIX: Skip non-Discord workspaces to prevent DM crashes
        if (ws.platform !== "DISCORD") continue;

        await runWithTenant(ws.workspaceId, async () => {
          try {
            const pendingRes = await axios.get("/reminders/pending").catch(() => ({ data: {} }));
            const { tasks = [], appointments = [], events = [] } = pendingRes.data || {};
            const sent = emptySent();

            // TASK REMINDERS
            for (const task of tasks) {
              const emp = task?.assignedTo;
              if (!emp?.externalId || !task.dueDate) continue;

              if (!task.reminderSent && inStandardWindow(task.dueDate)) {
                try {
                  const result = await notifyReminder(
                    client,
                    emp.externalId,
                    "Task",
                    task,
                    "30 minutes"
                  );
                  if (result !== false) sent.standard.taskIds.push(task.id);
                } catch (error) {
                  console.error(`❌ Task reminder failed (${task.id}):`, error.message);
                }
              }

              const custom = customMinutesFor(emp);
              if (
                custom &&
                custom !== 30 &&
                !task.customReminderSent &&
                inCustomWindow(task.dueDate, custom)
              ) {
                try {
                  const result = await notifyReminder(
                    client,
                    emp.externalId,
                    "Task",
                    task,
                    `${emp.reminderValue} ${emp.reminderUnit} before`
                  );
                  if (result !== false) sent.custom.taskIds.push(task.id);
                } catch (error) {
                  console.error(`❌ Custom task reminder failed (${task.id}):`, error.message);
                }
              }
            }

            // APPOINTMENT REMINDERS
            for (const appointment of appointments) {
              const emp = appointment?.assignee;
              if (!emp?.externalId || !appointment.startTime) continue;

              if (!appointment.reminderSent && inStandardWindow(appointment.startTime)) {
                try {
                  const result = await notifyReminder(
                    client,
                    emp.externalId,
                    "Appointment",
                    appointment,
                    "30 minutes"
                  );
                  if (result !== false) sent.standard.appointmentIds.push(appointment.id);
                } catch (error) {
                  console.error(
                    `❌ Appointment reminder failed (${appointment.id}):`,
                    error.message
                  );
                }
              }

              const custom = customMinutesFor(emp);
              if (
                custom &&
                custom !== 30 &&
                !appointment.customReminderSent &&
                inCustomWindow(appointment.startTime, custom)
              ) {
                try {
                  const result = await notifyReminder(
                    client,
                    emp.externalId,
                    "Appointment",
                    appointment,
                    `${emp.reminderValue} ${emp.reminderUnit} before`
                  );
                  if (result !== false) sent.custom.appointmentIds.push(appointment.id);
                } catch (error) {
                  console.error(
                    `❌ Custom appointment reminder failed (${appointment.id}):`,
                    error.message
                  );
                }
              }
            }

            // EVENT REMINDERS
            for (const event of events) {
              if (!event?.startDate || event.reminderSent) continue;
              if (!inStandardWindow(event.startDate)) continue;

              const targets = (event.assignees || []).filter(
                (a) => a?.externalId && a.reminderEnabled !== false
              );
              if (!targets.length) {
                sent.standard.eventIds.push(event.id);
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
                  if (result !== false) anySuccess = true;
                } catch (error) {
                  console.error(`❌ Event reminder failed (${event.id}):`, error.message);
                }
              }
              if (anySuccess) sent.standard.eventIds.push(event.id);
            }

            // MARK SENT
            if (hasSent(sent)) {
              await axios.post("/reminders/mark-sent", sent).catch((error) => {
                console.error(
                  `❌ Failed to mark reminders as sent (${ws.workspaceId}):`,
                  error.message
                );
              });
            }
          } catch (error) {
            console.error(`❌ Scheduler Error (${ws.workspaceId}):`, error.message);
          }
        });
      }
    } catch (error) {
      console.error("❌ Scheduler Core Error:", error.message);
    }
  });
  console.log("✅ Global Scheduler Engine started (Discord filtered)!");
}

module.exports = { startScheduler };
