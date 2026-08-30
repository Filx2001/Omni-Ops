const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { notifyReminder } = require("../utils/dmNotifier");
const { runWithTenant } = require("../utils/tenantContext");

function startScheduler(client) {
  cron.schedule("* * * * *", async () => {
    try {
      // Fetch all workspaces to process them one by one with tenant context
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        await runWithTenant(ws.workspaceId, async () => {
          try {
            const [empsRes, tasksRes, apptsRes, eventsRes] = await Promise.all([
              axios.get("/employees"),
              axios.get("/tasks"),
              axios.get("/calendar/appointments"),
              axios.get("/calendar/events"),
            ]);

            const employees = empsRes.data;
            const allTasks = tasksRes.data || [];
            const allAppts = apptsRes.data || [];
            const allEvents = eventsRes.data || [];

            for (const emp of employees) {
              if (!emp.reminderEnabled || !emp.externalId) continue;
              let customMinutes = null;
              if (emp.reminderUnit === "hours") customMinutes = emp.reminderValue * 60;
              else if (emp.reminderUnit === "days") customMinutes = emp.reminderValue * 24 * 60;

              const empTasks = allTasks.filter(
                (t) => t.assignedToId === emp.id || t.assignedTo?.id === emp.id
              );
              const empAppts = allAppts.filter(
                (a) => a.assigneeId === emp.id || a.assignee?.id === emp.id
              );
              const empEvents = allEvents.filter((e) => e.assignees?.some((a) => a.id === emp.id));

              await checkAndNotifyTasks(client, emp, customMinutes, empTasks);
              await checkAndNotifyAppointments(client, emp, customMinutes, empAppts);
              await checkAndNotifyEvents(client, emp, customMinutes, empEvents);
            }
          } catch (err) {
            console.error(`❌ Scheduler Error for workspace ${ws.workspaceId}:`, err.message);
          }
        });
      }
    } catch (error) {
      console.error("❌ Scheduler Core Error:", error.message);
    }
  });
  console.log("✅ Global Scheduler Engine started!");
}

async function checkAndNotifyTasks(client, emp, customMinutes, tasks = []) {
  try {
    for (const task of tasks) {
      if (!task.dueDate || task.status === "done" || task.status === "cancelled") continue;
      const diffInMinutes = Math.floor((new Date(task.dueDate).getTime() - Date.now()) / 60000);
      if (diffInMinutes === 30) {
        await notifyReminder(client, emp.externalId, "Task", task, "30 minutes");
      } else if (customMinutes && diffInMinutes === customMinutes && customMinutes !== 30) {
        await notifyReminder(
          client,
          emp.externalId,
          "Task",
          task,
          `${emp.reminderValue} ${emp.reminderUnit}`
        );
      }
    }
  } catch (error) {}
}

async function checkAndNotifyAppointments(client, emp, customMinutes, appts = []) {
  try {
    for (const appt of appts) {
      if (!appt.startTime || appt.isAllDay) continue;
      const diffInMinutes = Math.floor((new Date(appt.startTime).getTime() - Date.now()) / 60000);
      if (diffInMinutes === 30) {
        await notifyReminder(client, emp.externalId, "Appointment", appt, "30 minutes");
      } else if (customMinutes && diffInMinutes === customMinutes && customMinutes !== 30) {
        await notifyReminder(
          client,
          emp.externalId,
          "Appointment",
          appt,
          `${emp.reminderValue} ${emp.reminderUnit}`
        );
      }
    }
  } catch (error) {}
}

async function checkAndNotifyEvents(client, emp, customMinutes, events = []) {
  try {
    for (const event of events) {
      if (!event.startDate) continue;
      const diffInMinutes = Math.floor((new Date(event.startDate).getTime() - Date.now()) / 60000);
      if (diffInMinutes === 30) {
        await notifyReminder(client, emp.externalId, "Event", event, "30 minutes");
      } else if (customMinutes && diffInMinutes === customMinutes && customMinutes !== 30) {
        await notifyReminder(
          client,
          emp.externalId,
          "Event",
          event,
          `${emp.reminderValue} ${emp.reminderUnit}`
        );
      }
    }
  } catch (error) {}
}

module.exports = { startScheduler };
