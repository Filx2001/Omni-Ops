/**
 * Slack modal builders.
 */

/** Modal for creating a task. */
function buildCreateTaskModal() {
  return {
    type: "modal",
    callback_id: "task_create_modal",
    title: { type: "plain_text", text: "Create Task", emoji: true },
    submit: { type: "plain_text", text: "Create", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "title_block",
        element: {
          type: "plain_text_input",
          action_id: "title",
          placeholder: { type: "plain_text", text: "e.g., Review Q3 reports" },
        },
        label: { type: "plain_text", text: "Title", emoji: true },
      },
      {
        type: "input",
        block_id: "employee_block",
        element: {
          type: "external_select",
          action_id: "employee",
          placeholder: { type: "plain_text", text: "Search employee..." },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "Assign To", emoji: true },
      },
      {
        type: "input",
        block_id: "priority_block",
        element: {
          type: "static_select",
          action_id: "priority",
          placeholder: { type: "plain_text", text: "Select priority" },
          options: [
            { text: { type: "plain_text", text: "🟢 Low", emoji: true }, value: "low" },
            { text: { type: "plain_text", text: "🟡 Medium", emoji: true }, value: "medium" },
            { text: { type: "plain_text", text: "🟠 High", emoji: true }, value: "high" },
            { text: { type: "plain_text", text: "🔴 Urgent", emoji: true }, value: "urgent" },
          ],
        },
        label: { type: "plain_text", text: "Priority", emoji: true },
      },
      {
        type: "input",
        block_id: "deadline_block",
        element: {
          type: "datepicker",
          action_id: "deadline",
          placeholder: { type: "plain_text", text: "Select a date" },
        },
        label: { type: "plain_text", text: "Deadline", emoji: true },
        optional: true,
      },
      {
        type: "input",
        block_id: "time_block",
        element: {
          type: "timepicker",
          action_id: "time",
          placeholder: { type: "plain_text", text: "Select a time" },
        },
        label: { type: "plain_text", text: "Time", emoji: true },
        optional: true,
      },
      {
        type: "input",
        block_id: "description_block",
        element: {
          type: "plain_text_input",
          action_id: "description",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add details, context, or instructions..." },
        },
        label: { type: "plain_text", text: "Description", emoji: true },
        optional: true,
      },
    ],
  };
}

/** Modal for deleting a task via typeahead search. */
function buildDeleteTaskModal() {
  return {
    type: "modal",
    callback_id: "task_delete_modal",
    title: { type: "plain_text", text: "Delete Task", emoji: true },
    submit: { type: "plain_text", text: "Delete", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "task_block",
        element: {
          type: "external_select",
          action_id: "task_select",
          placeholder: { type: "plain_text", text: "Search task by title..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Task to delete", emoji: true },
      },
    ],
  };
}

module.exports = { buildCreateTaskModal, buildDeleteTaskModal };
