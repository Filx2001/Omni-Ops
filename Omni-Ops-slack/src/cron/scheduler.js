const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildTaskBlock } = require("../utils/slackBlocks");

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

function startScheduler(app) {
  cron.schedule("* * * * *", async () => {
    try {
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        // 🔥 CRITICAL FIX: Skip non-Slack workspaces
        if (ws.platform !== "SLACK") continue;

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
                  const blocks = buildTaskBlock(task, "reminder", {
                    note: `⏰ Reminder: Due in ~30 minutes!`,
                  });
                  await app.client.chat.postMessage({
                    channel: emp.externalId,
                    text: `Task Reminder: ${task.title}`, // Accessibility fallback
                    blocks: blocks,
                  });
                  sent.standard.taskIds.push(task.id);
                } catch (error) {
                  console.error(`❌ Slack Task reminder failed (${task.id}):`, error.message);
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
                  const blocks = buildTaskBlock(task, "reminder", {
                    note: `⏰ Custom Reminder: Due in ${emp.reminderValue} ${emp.reminderUnit}!`,
                  });
                  await app.client.chat.postMessage({
                    channel: emp.externalId,
                    text: `Task Reminder: ${task.title}`,
                    blocks: blocks,
                  });
                  sent.custom.taskIds.push(task.id);
                } catch (error) {
                  console.error(
                    `❌ Slack Custom task reminder failed (${task.id}):`,
                    error.message
                  );
                }
              }
            }

            // APPOINTMENT REMINDERS
            for (const appointment of appointments) {
              const emp = appointment?.assignee;
              if (!emp?.externalId || !appointment.startTime) continue;

              if (!appointment.reminderSent && inStandardWindow(appointment.startTime)) {
                try {
                  await app.client.chat.postMessage({
                    channel: emp.externalId,
                    text: `Appointment Reminder: ${appointment.title || "Appointment"}`,
                    blocks: [
                      {
                        type: "section",
                        text: {
                          type: "mrkdwn",
                          text: `⏰ *Appointment Reminder*\n*${appointment.title || "Appointment"}*\nStarts in ~30 minutes.`,
                        },
                      },
                    ],
                  });
                  sent.standard.appointmentIds.push(appointment.id);
                } catch (error) {
                  console.error(
                    `❌ Slack Appointment reminder failed (${appointment.id}):`,
                    error.message
                  );
                }
              }
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
            console.error(`❌ Slack Scheduler Error (${ws.workspaceId}):`, error.message);
          }
        });
      }
    } catch (error) {
      console.error("❌ Slack Scheduler Core Error:", error.message);
    }
  });
  console.log("✅ Slack Scheduler Engine started (Slack filtered)!");
}

module.exports = { startScheduler };
