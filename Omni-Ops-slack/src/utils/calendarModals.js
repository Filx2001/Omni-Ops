/**
 * Modal builders for appointments and events.
 */

const { TYPE_LABELS } = require("./calendarUtils");

const SCOPE_OPTIONS = [
  { text: { type: "plain_text", text: "This one only", emoji: true }, value: "single" },
  { text: { type: "plain_text", text: "Whole series 🔁", emoji: true }, value: "series" },
];

/** Modal for creating an appointment. Empty times = all-day. */
function buildAppointmentModal() {
  return {
    type: "modal",
    callback_id: "appointment_create_modal",
    title: { type: "plain_text", text: "New Appointment", emoji: true },
    submit: { type: "plain_text", text: "Schedule", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "title_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "title",
          placeholder: { type: "plain_text", text: "Auto-named if left empty" },
        },
        label: { type: "plain_text", text: "Title", emoji: true },
      },
      {
        type: "input",
        block_id: "assignee_block",
        element: {
          type: "external_select",
          action_id: "employee",
          placeholder: { type: "plain_text", text: "Search employee..." },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "Assignee", emoji: true },
      },
      {
        type: "input",
        block_id: "date_block",
        element: {
          type: "datepicker",
          action_id: "date",
          placeholder: { type: "plain_text", text: "Select a date" },
        },
        label: { type: "plain_text", text: "Date", emoji: true },
      },
      {
        type: "input",
        block_id: "start_block",
        optional: true,
        element: {
          type: "timepicker",
          action_id: "start_time",
          placeholder: { type: "plain_text", text: "Start time" },
        },
        label: { type: "plain_text", text: "Start time", emoji: true },
        hint: {
          type: "plain_text",
          text: "Leave both times empty for an all-day appointment",
          emoji: true,
        },
      },
      {
        type: "input",
        block_id: "end_block",
        optional: true,
        element: {
          type: "timepicker",
          action_id: "end_time",
          placeholder: { type: "plain_text", text: "End time" },
        },
        label: { type: "plain_text", text: "End time", emoji: true },
      },
      {
        type: "input",
        block_id: "location_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "location",
          placeholder: { type: "plain_text", text: "Room, address or meeting link" },
        },
        label: { type: "plain_text", text: "Location", emoji: true },
      },
    ],
  };
}

/** Modal for editing an appointment; empty fields keep current values. */
function buildAppointmentEditModal() {
  return {
    type: "modal",
    callback_id: "appointment_edit_modal",
    title: { type: "plain_text", text: "Edit Appointment", emoji: true },
    submit: { type: "plain_text", text: "Save", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: {
          type: "external_select",
          action_id: "appointment_select",
          placeholder: { type: "plain_text", text: "Search appointment..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Appointment", emoji: true },
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
        block_id: "date_block",
        optional: true,
        element: { type: "datepicker", action_id: "date" },
        label: { type: "plain_text", text: "New date", emoji: true },
        hint: { type: "plain_text", text: "Required when changing times", emoji: true },
      },
      {
        type: "input",
        block_id: "start_block",
        optional: true,
        element: { type: "timepicker", action_id: "start_time" },
        label: { type: "plain_text", text: "New start time", emoji: true },
      },
      {
        type: "input",
        block_id: "end_block",
        optional: true,
        element: { type: "timepicker", action_id: "end_time" },
        label: { type: "plain_text", text: "New end time", emoji: true },
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
        block_id: "location_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "location" },
        label: { type: "plain_text", text: "New location", emoji: true },
      },
    ],
  };
}

/** Modal for deleting an appointment, with series scope. */
function buildAppointmentDeleteModal() {
  return {
    type: "modal",
    callback_id: "appointment_delete_modal",
    title: { type: "plain_text", text: "Delete Appointment", emoji: true },
    submit: { type: "plain_text", text: "Delete", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: {
          type: "external_select",
          action_id: "appointment_select",
          placeholder: { type: "plain_text", text: "Search appointment..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Appointment", emoji: true },
      },
      {
        type: "input",
        block_id: "scope_block",
        element: {
          type: "static_select",
          action_id: "scope",
          initial_option: SCOPE_OPTIONS[0],
          options: SCOPE_OPTIONS,
        },
        label: { type: "plain_text", text: "Scope", emoji: true },
      },
    ],
  };
}

/** Modal for creating a single-day event. */
function buildEventModal() {
  return {
    type: "modal",
    callback_id: "event_create_modal",
    title: { type: "plain_text", text: "New Event", emoji: true },
    submit: { type: "plain_text", text: "Create", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "title_block",
        element: { type: "plain_text_input", action_id: "title" },
        label: { type: "plain_text", text: "Title", emoji: true },
      },
      {
        type: "input",
        block_id: "type_block",
        element: {
          type: "static_select",
          action_id: "type",
          options: Object.entries(TYPE_LABELS).map(([value, label]) => ({
            text: { type: "plain_text", text: label, emoji: true },
            value,
          })),
        },
        label: { type: "plain_text", text: "Type", emoji: true },
      },
      {
        type: "input",
        block_id: "date_block",
        element: { type: "datepicker", action_id: "date" },
        label: { type: "plain_text", text: "Date", emoji: true },
      },
      {
        type: "input",
        block_id: "start_block",
        optional: true,
        element: { type: "timepicker", action_id: "start_time" },
        label: { type: "plain_text", text: "Start time", emoji: true },
        hint: {
          type: "plain_text",
          text: "Empty = all day; timed events default to 1 hour",
          emoji: true,
        },
      },
      {
        type: "input",
        block_id: "end_block",
        optional: true,
        element: { type: "timepicker", action_id: "end_time" },
        label: { type: "plain_text", text: "End time", emoji: true },
      },
      {
        type: "input",
        block_id: "assignees_block",
        optional: true,
        element: {
          type: "multi_external_select",
          action_id: "employee_multi",
          placeholder: { type: "plain_text", text: "Search employees..." },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "Assignees", emoji: true },
      },
      {
        type: "input",
        block_id: "description_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "description", multiline: true },
        label: { type: "plain_text", text: "Description", emoji: true },
      },
    ],
  };
}

/** Modal for deleting an event, with series scope. */
function buildEventDeleteModal() {
  return {
    type: "modal",
    callback_id: "event_delete_modal",
    title: { type: "plain_text", text: "Delete Event", emoji: true },
    submit: { type: "plain_text", text: "Delete", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: {
          type: "external_select",
          action_id: "event_select",
          placeholder: { type: "plain_text", text: "Search event..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Event", emoji: true },
      },
      {
        type: "input",
        block_id: "scope_block",
        element: {
          type: "static_select",
          action_id: "scope",
          initial_option: SCOPE_OPTIONS[0],
          options: SCOPE_OPTIONS,
        },
        label: { type: "plain_text", text: "Scope", emoji: true },
      },
    ],
  };
}

/** Modal for editing an event; empty fields keep current values. */
function buildEventEditModal() {
  return {
    type: "modal",
    callback_id: "event_edit_modal",
    title: { type: "plain_text", text: "Edit Event", emoji: true },
    submit: { type: "plain_text", text: "Save", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: {
          type: "external_select",
          action_id: "event_select",
          placeholder: { type: "plain_text", text: "Search event..." },
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Event", emoji: true },
      },
      {
        type: "input",
        block_id: "scope_block",
        element: {
          type: "static_select",
          action_id: "scope",
          initial_option: SCOPE_OPTIONS[0],
          options: SCOPE_OPTIONS,
        },
        label: { type: "plain_text", text: "Scope", emoji: true },
        hint: {
          type: "plain_text",
          text: "Series scope accepts title/type/time changes, not dates",
          emoji: true,
        },
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
        block_id: "type_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "type",
          placeholder: { type: "plain_text", text: "Keep current" },
          options: Object.entries(TYPE_LABELS).map(([value, label]) => ({
            text: { type: "plain_text", text: label, emoji: true },
            value,
          })),
        },
        label: { type: "plain_text", text: "New type", emoji: true },
      },
      {
        type: "input",
        block_id: "date_block",
        optional: true,
        element: { type: "datepicker", action_id: "date" },
        label: { type: "plain_text", text: "New date (single scope)", emoji: true },
      },
      {
        type: "input",
        block_id: "start_block",
        optional: true,
        element: { type: "timepicker", action_id: "start_time" },
        label: { type: "plain_text", text: "New start time", emoji: true },
      },
      {
        type: "input",
        block_id: "end_block",
        optional: true,
        element: { type: "timepicker", action_id: "end_time" },
        label: { type: "plain_text", text: "New end time", emoji: true },
      },
      {
        type: "input",
        block_id: "assignees_block",
        optional: true,
        element: {
          type: "multi_external_select",
          action_id: "employee_multi",
          placeholder: { type: "plain_text", text: "Keep current" },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "New assignees", emoji: true },
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
  buildAppointmentModal,
  buildAppointmentEditModal,
  buildAppointmentDeleteModal,
  buildEventModal,
  buildEventDeleteModal,
  buildEventEditModal,
};
