const PRIORITY_EMOJIS = {
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  urgent: "🔴",
};

const STATUS_EMOJIS = {
  pending: "🟡 Pending",
  in_progress: "🔵 In Progress",
  done: "🟢 Done",
  cancelled: "🔴 Cancelled",
};

function formatDeadline(dateString) {
  if (!dateString) return "No deadline";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "No deadline";
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("en-GB")} ${time}`;
}

/**
 * Builds a rich Block Kit payload for a Task (similar to Discord Embed)
 */
function buildTaskBlock(task, action = "view", options = {}) {
  const priorityEmoji = PRIORITY_EMOJIS[task.priority] || "⚪";
  const statusText = STATUS_EMOJIS[task.status] || task.status;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text:
          action === "create"
            ? "✅ Task Created"
            : action === "update"
              ? "✏️ Task Updated"
              : action === "delete"
                ? "🗑️ Task Deleted"
                : "📋 Task Details",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📝 Title*\n${task.title}` },
        {
          type: "mrkdwn",
          text: `*🔥 Priority*\n${priorityEmoji} ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}`,
        },
        { type: "mrkdwn", text: `*👤 Assigned To*\n${task.assignedTo?.name || "Unassigned"}` },
        { type: "mrkdwn", text: `*📅 Deadline*\n${formatDeadline(task.dueDate)}` },
      ],
    },
  ];

  if (task.status) {
    blocks.push({
      type: "section",
      fields: [{ type: "mrkdwn", text: `*📊 Status*\n${statusText}` }],
    });
  }

  if (task.description) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📄 Description*\n${task.description}` },
    });
  }

  if (options.note) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📝 Note*\n${options.note}` },
    });
  }

  if (task.completedLate && task.status === "done") {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*⚠️ Delay*\n${task.daysLate} day(s) late` },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Updated: <!date^${Math.floor(Date.now() / 1000)}^{date} at {time}|Just now>`,
      },
    ],
  });

  return blocks;
}

function buildErrorBlock(message) {
  return [{ type: "section", text: { type: "mrkdwn", text: `❌ *Error*: ${message}` } }];
}

function buildSuccessBlock(message) {
  return [{ type: "section", text: { type: "mrkdwn", text: `✅ *Success*: ${message}` } }];
}

module.exports = {
  buildTaskBlock,
  buildErrorBlock,
  buildSuccessBlock,
  PRIORITY_EMOJIS,
  STATUS_EMOJIS,
};
