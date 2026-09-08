const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildErrorBlock } = require("../utils/slackBlocks");

async function handleDashboardCommand({ command, ack, say }) {
  await ack();
  try {
    const stats = await runWithTenant(command.team_id, () => axios.get(`/dashboard`));
    const s = stats.data;
    await say({
      text: "Dashboard",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "📊 Omni-Ops Management Dashboard" } },
        {
          type: "section",
          text: { type: "mrkdwn", text: "Real-time overview of employees and tasks" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*👥 Employees*\n${s.totalEmployees}` },
            { type: "mrkdwn", text: `*📋 Total Tasks*\n${s.totalTasks}` },
            { type: "mrkdwn", text: `*📂 Open Tasks*\n${s.openTasks}` },
            { type: "mrkdwn", text: `*⏳ Pending*\n${s.pendingTasks}` },
            { type: "mrkdwn", text: `*✅ Completed*\n${s.completedTasks}` },
            { type: "mrkdwn", text: `*🚨 Overdue*\n${s.overdueTasks}` },
            { type: "mrkdwn", text: `*🔥 High Priority*\n${s.highPriorityTasks}` },
            { type: "mrkdwn", text: `*⚡ Urgent*\n${s.urgentTasks}` },
          ],
        },
      ],
      response_type: "ephemeral",
    });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    await say({
      text: "Error",
      blocks: buildErrorBlock("Failed to fetch dashboard data."),
      response_type: "ephemeral",
    });
  }
}

module.exports = { handleDashboardCommand };
