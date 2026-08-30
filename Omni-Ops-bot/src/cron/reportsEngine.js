const cron = require("node-cron");
const axios = require("../utils/axiosInstance");
const { EmbedBuilder } = require("discord.js");
const { runWithTenant } = require("../utils/tenantContext");

function startDailyReport(client) {
  // Run every hour to check if any workspace is currently at 8:00 AM local time
  cron.schedule("0 * * * *", async () => {
    try {
      const wsRes = await axios.get("/workspaces").catch(() => ({ data: [] }));
      const workspaces = wsRes.data || [];

      for (const ws of workspaces) {
        const tz = ws.timezone || "UTC";
        const currentHour = parseInt(
          new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: tz }),
          10
        );

        // Only generate and send if it's 8 AM in this workspace's timezone
        if (currentHour !== 8) continue;

        await runWithTenant(ws.workspaceId, async () => {
          try {
            console.log(`📊 Generating Daily Morning Brief for workspace ${ws.workspaceId}...`);

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

            const embed = new EmbedBuilder()
              .setColor("#FFB347")
              .setAuthor({
                name: ws.organizationName || "Omni-Ops System",
                iconURL: client.user.displayAvatarURL(),
              })
              .setTitle("🌅 Morning Brief")
              .setDescription(
                "Good morning! ☕\nHere is your daily update on work and tasks:\n\u200B"
              )
              .addFields(
                {
                  name: "👥 New Leads (Pending)",
                  value: `> **${newLeadsCount}** lead(s)`,
                  inline: true,
                },
                {
                  name: "📅 Today's Appointments",
                  value: `> **${apptsTodayCount}** appointment(s)`,
                  inline: true,
                },
                { name: "\u200B", value: "━━━━━━━━━━━━━━━━━━━━", inline: false },
                {
                  name: "✅ Tasks Completed (Yesterday)",
                  value: `> **${completedYesterday}** task(s)`,
                  inline: true,
                },
                { name: "🚨 Overdue Tasks", value: `> **${overdueTasks}** task(s)`, inline: true }
              )
              .setThumbnail("https://cdn-icons-png.flaticon.com/512/3222/3222800.png")
              .setFooter({ text: "Daily Executive Report" })
              .setTimestamp();

            for (const dir of managers) {
              try {
                const user = await client.users.fetch(dir.externalId);
                await user.send({ embeds: [embed] });
              } catch (err) {
                console.log(`❌ Could not send report to ${dir.name}`);
              }
            }
            console.log(`✅ Morning Brief sent successfully for workspace ${ws.workspaceId}!`);
          } catch (error) {
            console.error(`❌ Daily Report Error for workspace ${ws.workspaceId}:`, error.message);
          }
        });
      }
    } catch (error) {
      console.error("❌ Daily Report Core Error:", error.message);
    }
  });
  console.log("✅ Daily Report Engine started! (Checking timezones every hour)");
}

module.exports = { startDailyReport };
