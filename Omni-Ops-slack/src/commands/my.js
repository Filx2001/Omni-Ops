const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");

const BILLING_ROLES = ["Admin", "Manager", "Sales", "Finance"];

async function getMyEmployee(workspaceId, slackUserId) {
  const res = await runWithTenant(workspaceId, () =>
    axios.get(`/employees/external/${slackUserId}`)
  );
  return res.data;
}

async function handleMyCommand({ command, ack, say }) {
  await ack();
  const workspaceId = command.team_id;
  const slackUserId = command.user_id;
  const args = command.text.trim().split(/\s+/);
  const sub = args[0]?.toLowerCase();

  try {
    const employee = await getMyEmployee(workspaceId, slackUserId);

    if (sub === "profile" || !sub) {
      const tasks = (
        await runWithTenant(workspaceId, () => axios.get(`/tasks/employee/${employee.id}`))
      ).data;
      const active = tasks.filter((t) => ["pending", "in_progress"].includes(t.status)).length;
      const done = tasks.filter((t) => t.status === "done").length;
      const overdue = tasks.filter(
        (t) =>
          t.dueDate && new Date(t.dueDate) < new Date() && !["done", "cancelled"].includes(t.status)
      ).length;
      const reminder = employee.reminderEnabled
        ? `🔔 On (${employee.reminderValue} ${employee.reminderUnit})`
        : "🔕 Off";

      await say({
        text: "Profile",
        blocks: [
          { type: "header", text: { type: "plain_text", text: `👤 ${employee.name}` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Role*\n${employee.role?.name || "None"}` },
              { type: "mrkdwn", text: `*Email*\n${employee.email || "N/A"}` },
              { type: "mrkdwn", text: `*Phone*\n${employee.phone || "N/A"}` },
              { type: "mrkdwn", text: `*Reminders*\n${reminder}` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*📊 Tasks:* 🟢 Done: ${done} | 🔵 Active: ${active} | 🚨 Overdue: ${overdue}`,
            },
          },
        ],
        response_type: "ephemeral",
      });
    } else if (sub === "tasks") {
      const tasks = (
        await runWithTenant(workspaceId, () => axios.get(`/tasks/employee/${employee.id}`))
      ).data;
      const activeTasks = tasks
        .filter((t) => !["done", "cancelled"].includes(t.status))
        .slice(0, 10);
      if (!activeTasks.length)
        return say({
          text: "No tasks",
          blocks: buildSuccessBlock("No active tasks assigned."),
          response_type: "ephemeral",
        });

      const blocks = [{ type: "header", text: { type: "plain_text", text: "📋 My Active Tasks" } }];
      activeTasks.forEach((t) => {
        const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-GB") : "No deadline";
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*${t.title}*\n${t.status} · ${t.priority} · ⏰ ${due}` },
        });
      });
      await say({ text: "My tasks", blocks, response_type: "ephemeral" });
    } else if (sub === "appointments") {
      const appts = (await runWithTenant(workspaceId, () => axios.get(`/calendar/appointments`)))
        .data;
      const mine = appts
        .filter((a) => a.assigneeId === employee.id && new Date(a.endTime) > new Date())
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
        .slice(0, 10);
      if (!mine.length)
        return say({
          text: "No appointments",
          blocks: buildSuccessBlock("No upcoming appointments."),
          response_type: "ephemeral",
        });

      const blocks = [{ type: "header", text: { type: "plain_text", text: "📅 My Appointments" } }];
      mine.forEach((a) => {
        const start = new Date(a.startTime).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${a.title || "Appointment"}* (${a.day || ""})\n📍 ${a.location || "TBA"} · ⏰ ${start}`,
          },
        });
      });
      await say({ text: "My appointments", blocks, response_type: "ephemeral" });
    } else if (sub === "performance") {
      const tasks = (
        await runWithTenant(workspaceId, () => axios.get(`/tasks/employee/${employee.id}`))
      ).data;
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === "done").length;
      const late = tasks.filter((t) => t.completedLate).length;
      const avgDelay = late
        ? (tasks.reduce((s, t) => s + (t.daysLate || 0), 0) / late).toFixed(1)
        : 0;
      const rate = total ? ((completed / total) * 100).toFixed(1) : 0;
      const score = Math.max(
        0,
        Math.round(rate - (completed ? (late / completed) * 100 : 0) * 0.5 - avgDelay)
      );

      await say({
        text: "Performance",
        blocks: [
          { type: "header", text: { type: "plain_text", text: `📊 ${employee.name} Performance` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Total*\n${total}` },
              { type: "mrkdwn", text: `*Completed*\n${completed}` },
              { type: "mrkdwn", text: `*Late*\n${late}` },
              { type: "mrkdwn", text: `*Avg Delay*\n${avgDelay}d` },
              { type: "mrkdwn", text: `*Rate*\n${rate}%` },
              { type: "mrkdwn", text: `*Score*\n${score}/100` },
            ],
          },
        ],
        response_type: "ephemeral",
      });
    } else if (sub === "reminders") {
      const unit = args[1]?.toLowerCase();
      const value = parseInt(args[2]);
      if (unit === "off") {
        await runWithTenant(workspaceId, () =>
          axios.patch(`/employees/${employee.id}/reminder`, {
            reminderEnabled: false,
            reminderValue: 0,
            reminderUnit: "off",
          })
        );
        return say({
          text: "Reminders off",
          blocks: buildSuccessBlock("🔕 Global reminders disabled."),
          response_type: "ephemeral",
        });
      }
      if (!["hours", "days"].includes(unit) || !value || value <= 0) {
        return say({
          text: "Usage",
          blocks: buildErrorBlock("Usage: `/omni-my reminders <hours|days|off> [value]`"),
          response_type: "ephemeral",
        });
      }
      await runWithTenant(workspaceId, () =>
        axios.patch(`/employees/${employee.id}/reminder`, {
          reminderEnabled: true,
          reminderValue: value,
          reminderUnit: unit,
        })
      );
      await say({
        text: "Reminders updated",
        blocks: buildSuccessBlock(`⏰ Reminders set to *${value} ${unit}* before deadlines.`),
        response_type: "ephemeral",
      });
    } else {
      await say({
        text: "Usage",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Subcommands:*\n• `profile` • `tasks` • `appointments` • `performance`\n• `reminders <hours|days|off> [value]`",
            },
          },
        ],
        response_type: "ephemeral",
      });
    }
  } catch (err) {
    console.error("My command error:", err.message);
    await say({
      text: "Error",
      blocks: buildErrorBlock(
        "Your account is not linked to an employee profile. Run `/omni-employee register`."
      ),
      response_type: "ephemeral",
    });
  }
}

module.exports = { handleMyCommand };
