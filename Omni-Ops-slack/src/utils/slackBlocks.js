/**
 * Slack Block Kit Builders
 *
 * Reusable functions for building Slack message blocks.
 * Provides consistent formatting across all bot responses.
 *
 * @module utils/slackBlocks
 */

const PRIORITY_EMOJIS = {
  low: "",
  medium: "🟡",
  high: "🟠",
  urgent: "🔴",
};

const STATUS_EMOJIS = {
  pending: " Pending",
  in_progress: "🔵 In Progress",
  done: "🟢 Done",
  cancelled: "🔴 Cancelled",
};

/**
 * Formats a deadline date for display.
 * Shows date + time if time is set, otherwise date only.
 *
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string
 */
function formatDeadline(dateString) {
  if (!dateString) return "No deadline";
  const d = new Date(dateString);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("en-GB")} ${time}`;
}

/**
 * Builds a rich Block Kit payload for displaying task information.
 *
 * @param {Object} task - Task object from API
 * @param {string} [action='view'] - Action context (create, update, delete, view, reminder)
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.note] - Optional note to display
 * @returns {Array} Array of Slack block objects
 */
function buildTaskBlock(task, action = "view", options = {}) {
  const priorityEmoji = PRIORITY_EMOJIS[task.priority] || "⚪";
  const statusText = STATUS_EMOJIS[task.status] || task.status;

  const headerText =
    {
      create: "✅ Task Created",
      update: "✏️ Task Updated",
      delete: "🗑️ Task Deleted",
      reminder: "⏰ Task Reminder",
      view: "📋 Task Details",
    }[action] || "Task";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*📝 Title*\n${task.title}`,
        },
        {
          type: "mrkdwn",
          text: `*🔥 Priority*\n${priorityEmoji} ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}`,
        },
        {
          type: "mrkdwn",
          text: `*👤 Assigned To*\n${task.assignedTo?.name || "Unassigned"}`,
        },
        {
          type: "mrkdwn",
          text: `*📅 Deadline*\n${formatDeadline(task.dueDate)}`,
        },
      ],
    },
  ];

  // Add status if available
  if (task.status) {
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*📊 Status*\n${statusText}`,
        },
      ],
    });
  }

  // Add description if available
  if (task.description) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📄 Description*\n${task.description}`,
      },
    });
  }

  // Add custom note if provided
  if (options.note) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📝 Note*\n${options.note}`,
      },
    });
  }

  // Add late completion warning
  if (task.completedLate && task.status === "done") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Delay*\n${task.daysLate} day(s) late`,
      },
    });
  }

  // Add timestamp context
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

/**
 * Builds an error message block.
 *
 * @param {string} message - Error message to display
 * @returns {Array} Array containing error block
 */
function buildErrorBlock(message) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `❌ *Error*\n${message}`,
      },
    },
  ];
}

/**
 * Builds a success message block.
 *
 * @param {string} message - Success message to display
 * @returns {Array} Array containing success block
 */
function buildSuccessBlock(message) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ *Success*\n${message}`,
      },
    },
  ];
}

module.exports = {
  buildTaskBlock,
  buildErrorBlock,
  buildSuccessBlock,
  PRIORITY_EMOJIS,
  STATUS_EMOJIS,
};
