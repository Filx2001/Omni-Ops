/**
 * /omni-my command: personal workspace (profile, tasks, appointments,
 * calendar, performance, reminders). All output is ephemeral.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");

const STATUS_MAP = {
  pending: "🟡 Pending",
  in_progress: "🔵 In Progress",
  done: "🟢 Done",
  cancelled: "🔴 Cancelled",
};

const PRIORITY_MAP = {
  low: "🟢 Low",
  medium: "🟡 Medium",
  high: "🟠 High",
  urgent: "🔴 Urgent",
};

const TYPE_EMOJI = {
  meeting: "🤝",
  deadline: "⏳",
  milestone: "🏆",
  workshop: "🛠️",
  social: "🎈",
  event: "📅",
};

/** Slack-native date token; renders in each viewer's own timezone. */
function slackDate(dateValue, withTime = true) {
  const ts = Math.floor(new Date(dateValue).getTime() / 1000);
  const fmt = withTime ? "{date} at {time}" : "{date}";
  const fallback = new Date(dateValue).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  return `<!date^${ts}^${fmt}|${fallback}>`;
}

/** Time-only Slack date token, for range endings. */
function slackTime(dateValue) {
  const ts = Math.floor(new Date(dateValue).getTime() / 1000);
  const fallback = new Date(dateValue).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `<!date^${ts}^{time}|${fallback}>`;
}

const isOverdue = (t) =>
  t.dueDate && new Date(t.dueDate) < new Date() && !["done", "cancelled"].includes(t.status);

/** Overdue first, then open tasks, then by priority weight. */
function sortTasks(tasks) {
  const order = { urgent: 4, high: 3, medium: 2, low: 1 };
  return [...tasks].sort((a, b) => {
    if (isOverdue(a) && !isOverdue(b)) return -1;
    if (!isOverdue(a) && isOverdue(b)) return 1;
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    return (order[b.priority] || 0) - (order[a.priority] || 0);
  });
}

async function getMyEmployee(workspaceId, slackUserId) {
  const res = await runWithTenant(workspaceId, () =>
    axios.get(`/employees/external/${slackUserId}`)
  );
  return res.data;
}

module.exports = {
  /** Routes /omni-my <subcommand>; no subcommand defaults to profile. */
  async handleMyCommand({ command, ack, say }) {
    await ack();
    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const sub = command.text.trim().split(/\s+/)[0]?.toLowerCase() || "profile";

    try {
      const employee = await getMyEmployee(workspaceId, slackUserId);

      if (sub === "profile") {
        const tasks = (
          await runWithTenant(workspaceId, () => axios.get(`/tasks/employee/${employee.id}`))
        ).data;
        const done = tasks.filter((t) => t.status === "done").length;
        const active = tasks.filter((t) => ["pending", "in_progress"].includes(t.status)).length;
        const overdue = tasks.filter(isOverdue).length;
        const reminder = employee.reminderEnabled
          ? `🔔 On (${employee.reminderValue} ${employee.reminderUnit})`
          : "🔕 Off";

        await say({
          text: `${employee.name} profile`,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: `👤 ${employee.name}`, emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*🎭 Role*\n${employee.role?.name || "No role"}` },
                { type: "mrkdwn", text: `*⏰ Reminders*\n${reminder}` },
                { type: "mrkdwn", text: `*📧 Email*\n${employee.email || "N/A"}` },
                { type: "mrkdwn", text: `*📱 Phone*\n${employee.phone || "N/A"}` },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*📊 Quick Task Overview*\n🟢 Done: ${done}   |   🔵 Active: ${active}   |   🚨 Overdue: ${overdue}`,
              },
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: "Omni-Ops · personal workspace · visible only to you" },
              ],
            },
          ],
          response_type: "ephemeral",
        });
      } else if (sub === "tasks") {
        const tasks = (
          await runWithTenant(workspaceId, () => axios.get(`/tasks/employee/${employee.id}`))
        ).data;
        const open = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
        if (!open.length) {
          return say({
            text: "No active tasks",
            blocks: buildSuccessBlock("No active tasks assigned. Enjoy the calm."),
            response_type: "ephemeral",
          });
        }
        const sorted = sortTasks(open).slice(0, 10);
        const blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: `📋 ${employee.name}'s Tasks`, emoji: true },
          },
          ...sorted.map((t) => ({
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `${isOverdue(t) ? "🚨" : "▪️"} *${t.title}*\n` +
                `${STATUS_MAP[t.status] || t.status} · ${PRIORITY_MAP[t.priority] || t.priority} · ` +
                `⏰ ${t.dueDate ? slackDate(t.dueDate) : "No deadline"}`,
            },
          })),
        ];
        if (open.length > 10) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `Showing 10 of ${open.length} open tasks.` }],
          });
        }
        await say({ text: `${employee.name} tasks`, blocks, response_type: "ephemeral" });
      } else if (sub === "appointments") {
        const appts = (await runWithTenant(workspaceId, () => axios.get(`/calendar/appointments`)))
          .data;
        const mine = appts
          .filter((a) => a.assigneeId === employee.id && new Date(a.endTime) > new Date())
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
          .slice(0, 10);
        if (!mine.length) {
          return say({
            text: "No appointments",
            blocks: buildSuccessBlock("No upcoming appointments on your schedule."),
            response_type: "ephemeral",
          });
        }
        const blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: `📅 Schedule — ${employee.name}`, emoji: true },
          },
          ...mine.map((a) => ({
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*${a.title || "Appointment"}*${a.day ? ` (${a.day})` : ""}\n` +
                `📍 ${a.location || "TBA"} · ` +
                (a.isAllDay
                  ? `📆 ${slackDate(a.startTime, false)} · All day`
                  : `⏰ ${slackDate(a.startTime)} → ${slackTime(a.endTime)}`),
            },
          })),
        ];
        await say({ text: `${employee.name} appointments`, blocks, response_type: "ephemeral" });
      } else if (sub === "calendar") {
        const events = (await runWithTenant(workspaceId, () => axios.get(`/calendar/events`))).data;
        const upcoming = events
          .filter((e) => new Date(e.endDate) > new Date())
          .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
          .slice(0, 10);
        if (!upcoming.length) {
          return say({
            text: "No events",
            blocks: buildSuccessBlock("No upcoming organization events."),
            response_type: "ephemeral",
          });
        }
        const blocks = [
          { type: "header", text: { type: "plain_text", text: "📅 Upcoming Events", emoji: true } },
          ...upcoming.map((e) => ({
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `${TYPE_EMOJI[e.type] || "📅"} *${e.title}*\n` +
                `⏰ ${e.isAllDay ? `${slackDate(e.startDate, false)} · All day` : slackDate(e.startDate)} · ` +
                `👤 ${e.createdBy?.name || "System"}`,
            },
          })),
        ];
        await say({ text: "Upcoming events", blocks, response_type: "ephemeral" });
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
        const rate = total ? ((completed / total) * 100).toFixed(1) : "0.0";
        const lateRate = completed ? ((late / completed) * 100).toFixed(1) : "0.0";
        const score = Math.max(
          0,
          Math.round(parseFloat(rate) - parseFloat(lateRate) * 0.5 - parseFloat(avgDelay))
        );
        let rating = "🔴 Needs Improvement";
        if (score >= 90) rating = "🏆 Excellent";
        else if (score >= 75) rating = "🟢 Good";
        else if (score >= 60) rating = "🟡 Average";

        await say({
          text: `${employee.name} performance`,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: `📊 ${employee.name} — Performance`, emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*📋 Total*\n${total}` },
                { type: "mrkdwn", text: `*🟢 Completed*\n${completed}` },
                { type: "mrkdwn", text: `*🔴 Late*\n${late}` },
                { type: "mrkdwn", text: `*📉 Late Rate*\n${lateRate}%` },
                { type: "mrkdwn", text: `*⏱ Avg Delay*\n${avgDelay} day(s)` },
                { type: "mrkdwn", text: `*📈 Completion*\n${rate}%` },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*⭐ Score:* ${score}/100   ·   *🏅 Rating:* ${rating}`,
              },
            },
          ],
          response_type: "ephemeral",
        });
      } else if (sub === "reminders") {
        const args = command.text.trim().split(/\s+/);
        const unit = args[1]?.toLowerCase();
        const value = parseInt(args[2], 10);

        if (unit === "off") {
          await runWithTenant(workspaceId, () =>
            axios.patch(`/employees/${employee.id}/reminder`, {
              reminderEnabled: false,
              reminderValue: 0,
              reminderUnit: "off",
            })
          );
          return say({
            text: "Reminders disabled",
            blocks: buildSuccessBlock(
              "🔕 Global reminders disabled for tasks, appointments and events."
            ),
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
        if (unit === "hours" && value > 168) {
          return say({
            text: "Invalid value",
            blocks: buildErrorBlock("Maximum reminder is 168 hours (7 days)."),
            response_type: "ephemeral",
          });
        }
        if (unit === "days" && value > 30) {
          return say({
            text: "Invalid value",
            blocks: buildErrorBlock("Maximum reminder is 30 days."),
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
        return say({
          text: "Reminders updated",
          blocks: buildSuccessBlock(
            `⏰ You will be reminded *${value} ${unit}* before every task deadline, appointment and event.`
          ),
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
                text:
                  "*Available subcommands:*\n" +
                  "• `/omni-my profile` — Your card and quick stats\n" +
                  "• `/omni-my tasks` — Your open tasks, overdue first\n" +
                  "• `/omni-my appointments` — Your upcoming schedule\n" +
                  "• `/omni-my calendar` — Organization events\n" +
                  "• `/omni-my performance` — Score and rating\n" +
                  "• `/omni-my reminders <hours|days|off> [value]` — Reminder settings",
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
          "Your account is not linked to an employee profile. Run `/omni-employee register` first."
        ),
        response_type: "ephemeral",
      });
    }
  },
};
