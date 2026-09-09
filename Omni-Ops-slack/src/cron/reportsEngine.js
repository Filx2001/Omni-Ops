const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { isValidTimeZone } = require("../utils/slackDates");

function startDailyReport(client) {
  // Run every hour to check if any workspace is currently at 8:00 AM local time
  cron.schedule("0 * * * *", async () => {
    try {
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        // Only process Slack workspaces
        if (ws.platform !== "SLACK") continue;

        const tz = isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
        const currentHour = parseInt(
          new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: tz }),
          10
        );

        // Only generate and send if it's 8 AM in this workspace's timezone
        if (currentHour !== 8) continue;

        await runWithTenant(ws.workspaceId, async () => {
          try {
            console.log(
              `📊 Generating Daily Morning Brief for Slack workspace ${ws.workspaceId}...`
            );

            const employeesRes = await axios.get("/employees");
            const managers = employeesRes.data.filter(
              (emp) =>
                ["Admin", "Manager"].includes(emp.role?.name) &&
                emp.externalId &&
                emp.dailyReportEnabled !== false
            );

            if (managers.length === 0) return;

            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfYesterday = new Date(startOfToday);
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);
            const endOfToday = new Date(startOfToday);
            endOfToday.setDate(endOfToday.getDate() + 1);

            let completedYesterday = 0;
            let overdueTasks = 0;

            try {
              const tasksRes = await axios.get("/tasks");
              const tasks = tasksRes.data;
              completedYesterday = tasks.filter(
                (t) =>
                  t.status === "done" &&
                  new Date(t.updatedAt || t.createdAt) >= startOfYesterday &&
                  new Date(t.updatedAt || t.createdAt) < startOfToday
              ).length;
              overdueTasks = tasks.filter(
                (t) =>
                  t.dueDate &&
                  new Date(t.dueDate) < startOfToday &&
                  !["done", "cancelled"].includes(t.status)
              ).length;
            } catch (e) {}

            let newLeadsCount = 0;
            try {
              const leadsRes = await axios.get("/crm/leads");
              const newLeads = leadsRes.data.filter(
                (l) => l.status === "NEW" || l.status === "🆕 New"
              );
              newLeadsCount = newLeads.length;
            } catch (e) {}

            let apptsTodayCount = 0;
            try {
              const apptsRes = await axios.get("/calendar/appointments");
              const apptsToday = apptsRes.data.filter(
                (a) =>
                  a.startTime &&
                  new Date(a.startTime) >= startOfToday &&
                  new Date(a.startTime) < endOfToday
              );
              apptsTodayCount = apptsToday.length;
            } catch (e) {}

            const blocks = [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "🌅 Morning Brief",
                  emoji: true,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Good morning! ☕\nHere is your daily update on work and tasks:",
                },
              },
              { type: "divider" },
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: `*👥 New Leads (Pending)*\n> *${newLeadsCount}* lead(s)`,
                  },
                  {
                    type: "mrkdwn",
                    text: `*📅 Today's Appointments*\n> *${apptsTodayCount}* appointment(s)`,
                  },
                ],
              },
              { type: "divider" },
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: `*✅ Tasks Completed (Yesterday)*\n> *${completedYesterday}* task(s)`,
                  },
                  {
                    type: "mrkdwn",
                    text: `*🚨 Overdue Tasks*\n> *${overdueTasks}* task(s)`,
                  },
                ],
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Daily Executive Report • ${ws.organizationName || "Omni-Ops System"}`,
                  },
                ],
              },
            ];

            for (const manager of managers) {
              try {
                // Open DM channel with the manager
                const dm = await client.conversations.open({
                  users: manager.externalId,
                });

                await client.chat.postMessage({
                  channel: dm.channel.id,
                  text: `Morning Brief for ${ws.organizationName || "Omni-Ops"}`,
                  blocks: blocks,
                });
              } catch (err) {
                console.log(`❌ Could not send report to ${manager.name}: ${err.message}`);
              }
            }

            console.log(
              `✅ Morning Brief sent successfully for Slack workspace ${ws.workspaceId}!`
            );
          } catch (error) {
            console.error(
              `❌ Daily Report Error for Slack workspace ${ws.workspaceId}:`,
              error.message
            );
          }
        });
      }
    } catch (error) {
      console.error("❌ Daily Report Core Error:", error.message);
    }
  });

  console.log("✅ Daily Report Engine started for Slack! (Checking timezones every hour)");
}

module.exports = { startDailyReport };
