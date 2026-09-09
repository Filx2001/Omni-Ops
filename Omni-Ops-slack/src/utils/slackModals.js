const TASK_STATUS_OPTIONS = [
  { text: { type: "plain_text", text: "🟡 Pending", emoji: true }, value: "pending" },
  { text: { type: "plain_text", text: "🔵 In Progress", emoji: true }, value: "in_progress" },
  { text: { type: "plain_text", text: "🟢 Done", emoji: true }, value: "done" },
  { text: { type: "plain_text", text: "🔴 Cancelled", emoji: true }, value: "cancelled" },
];

/** Modal for updating a task status (assignee or manager). */
function buildTaskStatusModal() {
  return {
    type: "modal",
    callback_id: "task_status_modal",
    title: { type: "plain_text", text: "Update Task Status", emoji: true },
    submit: { type: "plain_text", text: "Update", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "task_block",
        element: {
          type: "external_select",
          action_id: "task_select",
          placeholder: { type: "plain_text", text: "Search task..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Task", emoji: true },
      },
      {
        type: "input",
        block_id: "status_block",
        element: {
          type: "static_select",
          action_id: "status",
          placeholder: { type: "plain_text", text: "New status" },
          options: TASK_STATUS_OPTIONS,
        },
        label: { type: "plain_text", text: "New Status", emoji: true },
      },
    ],
  };
}

/** Modal for editing a task; empty fields keep current values. */
function buildTaskEditModal() {
  return {
    type: "modal",
    callback_id: "task_edit_modal",
    title: { type: "plain_text", text: "Edit Task", emoji: true },
    submit: { type: "plain_text", text: "Save", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "task_block",
        element: {
          type: "external_select",
          action_id: "task_select",
          placeholder: { type: "plain_text", text: "Search task..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Task", emoji: true },
      },
      {
        type: "input",
        block_id: "title_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "title" },
        label: { type: "plain_text", text: "New title", emoji: true },
      },
      {
        type: "input",
        block_id: "priority_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "priority",
          placeholder: { type: "plain_text", text: "Keep current" },
          options: [
            { text: { type: "plain_text", text: "🟢 Low", emoji: true }, value: "low" },
            { text: { type: "plain_text", text: "🟡 Medium", emoji: true }, value: "medium" },
            { text: { type: "plain_text", text: "🟠 High", emoji: true }, value: "high" },
            { text: { type: "plain_text", text: "🔴 Urgent", emoji: true }, value: "urgent" },
          ],
        },
        label: { type: "plain_text", text: "New priority", emoji: true },
      },
      {
        type: "input",
        block_id: "assignee_block",
        optional: true,
        element: {
          type: "external_select",
          action_id: "employee",
          placeholder: { type: "plain_text", text: "Keep current" },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "New assignee", emoji: true },
      },
      {
        type: "input",
        block_id: "deadline_block",
        optional: true,
        element: { type: "datepicker", action_id: "deadline" },
        label: { type: "plain_text", text: "New deadline", emoji: true },
      },
      {
        type: "input",
        block_id: "time_block",
        optional: true,
        element: { type: "timepicker", action_id: "time" },
        label: { type: "plain_text", text: "New time", emoji: true },
      },
      {
        type: "input",
        block_id: "description_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "description", multiline: true },
        label: { type: "plain_text", text: "New description", emoji: true },
      },
    ],
  };
}
module.exports = {
  buildCreateTaskModal,
  buildDeleteTaskModal,
  buildTaskStatusModal,
  buildTaskEditModal,
};
