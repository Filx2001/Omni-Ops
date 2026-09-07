/**
 * Slack Modal Builders
 *
 * Reusable functions for building Slack modals with Block Kit.
 * All modals follow Slack's design guidelines and accessibility standards.
 *
 * @module utils/slackModals
 */

/**
 * Builds the "Create Task" modal with all required fields.
 *
 * Features:
 * - Title (plain text input, required)
 * - Assign To (external select with typeahead, required)
 * - Priority (static select, required)
 * - Deadline (datepicker, optional)
 * - Time (timepicker, optional)
 * - Description (multiline text, optional)
 *
 * @returns {Object} Slack modal view object
 */
function buildCreateTaskModal() {
  return {
    type: "modal",
    callback_id: "task_create_modal",
    title: {
      type: "plain_text",
      text: "Create Task",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "Create",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true,
    },
    blocks: [
      /**
       * Title Field
       */
      {
        type: "input",
        block_id: "title_block",
        element: {
          type: "plain_text_input",
          action_id: "title",
          placeholder: {
            type: "plain_text",
            text: "e.g., Review Q3 reports",
          },
        },
        label: {
          type: "plain_text",
          text: "Title",
          emoji: true,
        },
      },

      /**
       * Assignee Field (External Select for Typeahead)
       * Populated via app.options handler
       */
      {
        type: "input",
        block_id: "employee_block",
        element: {
          type: "external_select",
          action_id: "employee",
          placeholder: {
            type: "plain_text",
            text: "Search employee...",
          },
          min_query_length: 2,
        },
        label: {
          type: "plain_text",
          text: "Assign To",
          emoji: true,
        },
      },

      /**
       * Priority Field (Static Select)
       */
      {
        type: "input",
        block_id: "priority_block",
        element: {
          type: "static_select",
          action_id: "priority",
          placeholder: {
            type: "plain_text",
            text: "Select priority",
          },
          options: [
            {
              text: { type: "plain_text", text: "🟢 Low", emoji: true },
              value: "low",
            },
            {
              text: { type: "plain_text", text: "🟡 Medium", emoji: true },
              value: "medium",
            },
            {
              text: { type: "plain_text", text: "🟠 High", emoji: true },
              value: "high",
            },
            {
              text: { type: "plain_text", text: "🔴 Urgent", emoji: true },
              value: "urgent",
            },
          ],
        },
        label: {
          type: "plain_text",
          text: "Priority",
          emoji: true,
        },
      },

      /**
       * Deadline Field (Date Picker)
       */
      {
        type: "input",
        block_id: "deadline_block",
        element: {
          type: "datepicker",
          action_id: "deadline",
          placeholder: {
            type: "plain_text",
            text: "Select a date",
          },
        },
        label: {
          type: "plain_text",
          text: "Deadline",
          emoji: true,
        },
        optional: true,
      },

      /**
       * Time Field (Time Picker)
       */
      {
        type: "input",
        block_id: "time_block",
        element: {
          type: "timepicker",
          action_id: "time",
          placeholder: {
            type: "plain_text",
            text: "Select a time",
          },
        },
        label: {
          type: "plain_text",
          text: "Time",
          emoji: true,
        },
        optional: true,
      },

      /**
       * Description Field (Multiline Text)
       */
      {
        type: "input",
        block_id: "description_block",
        element: {
          type: "plain_text_input",
          action_id: "description",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Add details, context, or instructions...",
          },
        },
        label: {
          type: "plain_text",
          text: "Description",
          emoji: true,
        },
        optional: true,
      },
    ],
  };
}

module.exports = {
  buildCreateTaskModal,
};
