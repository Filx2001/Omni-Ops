const SOURCE_OPTIONS = [
  { text: { type: "plain_text", text: "📞 Phone Call" }, value: "PHONE" },
  { text: { type: "plain_text", text: "🚶 Walk-in" }, value: "WALK_IN" },
  { text: { type: "plain_text", text: "🌐 Website" }, value: "WEBSITE" },
  { text: { type: "plain_text", text: "📱 Social Media" }, value: "SOCIAL" },
  { text: { type: "plain_text", text: "📥 Imported" }, value: "IMPORT" },
  { text: { type: "plain_text", text: "✍️ Manual" }, value: "MANUAL" },
];

const STATUS_OPTIONS = [
  { text: { type: "plain_text", text: "🆕 New" }, value: "NEW" },
  { text: { type: "plain_text", text: "📞 Contacted" }, value: "CONTACTED" },
  { text: { type: "plain_text", text: "⭐ Qualified" }, value: "QUALIFIED" },
  { text: { type: "plain_text", text: "✅ Converted" }, value: "CONVERTED" },
  { text: { type: "plain_text", text: "🚫 Not Interested" }, value: "LOST" },
];

function buildLeadAddModal() {
  return {
    type: "modal",
    callback_id: "lead_add_modal",
    title: { type: "plain_text", text: "Add Lead" },
    submit: { type: "plain_text", text: "Add" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "phone_block",
        element: {
          type: "plain_text_input",
          action_id: "phone",
          placeholder: { type: "plain_text", text: "+15551234567" },
        },
        label: { type: "plain_text", text: "Phone Number" },
      },
      {
        type: "input",
        block_id: "name_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "name" },
        label: { type: "plain_text", text: "Name" },
      },
      {
        type: "input",
        block_id: "source_block",
        optional: true,
        element: { type: "static_select", action_id: "source", options: SOURCE_OPTIONS },
        label: { type: "plain_text", text: "Source" },
      },
      {
        type: "input",
        block_id: "notes_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "notes", multiline: true },
        label: { type: "plain_text", text: "Notes" },
      },
    ],
  };
}

function buildLeadMultiModal() {
  return {
    type: "modal",
    callback_id: "lead_multi_modal",
    title: { type: "plain_text", text: "Bulk Add Leads" },
    submit: { type: "plain_text", text: "Add" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "source_block",
        element: { type: "static_select", action_id: "source", options: SOURCE_OPTIONS },
        label: { type: "plain_text", text: "Source" },
      },
      {
        type: "input",
        block_id: "phones_block",
        element: {
          type: "plain_text_input",
          action_id: "phones",
          multiline: true,
          max_length: 3000,
          placeholder: { type: "plain_text", text: "One per line or comma-separated" },
        },
        label: { type: "plain_text", text: "Phone Numbers" },
      },
      {
        type: "input",
        block_id: "notes_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "notes" },
        label: { type: "plain_text", text: "Note for all" },
      },
    ],
  };
}

function buildLeadFilterModal() {
  return {
    type: "modal",
    callback_id: "lead_filter_modal",
    title: { type: "plain_text", text: "Filter Leads" },
    submit: { type: "plain_text", text: "Search" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "start_block",
        element: {
          type: "plain_text_input",
          action_id: "start",
          placeholder: { type: "plain_text", text: "YYYY-MM-DD or today" },
        },
        label: { type: "plain_text", text: "Start Date" },
      },
      {
        type: "input",
        block_id: "end_block",
        element: {
          type: "plain_text_input",
          action_id: "end",
          placeholder: { type: "plain_text", text: "YYYY-MM-DD or tomorrow" },
        },
        label: { type: "plain_text", text: "End Date" },
      },
    ],
  };
}

function buildLeadSelectModal(callbackId, title, extraBlocks = []) {
  return {
    type: "modal",
    callback_id: callbackId,
    title: { type: "plain_text", text: title },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "lead_block",
        element: {
          type: "external_select",
          action_id: "lead_select",
          min_query_length: 1,
        },
        label: { type: "plain_text", text: "Select Lead" },
      },
      ...extraBlocks,
    ],
  };
}

function buildCampaignNewModal() {
  return {
    type: "modal",
    callback_id: "campaign_new_modal",
    title: { type: "plain_text", text: "New Campaign" },
    submit: { type: "plain_text", text: "Preview" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name_block",
        element: { type: "plain_text_input", action_id: "name" },
        label: { type: "plain_text", text: "Campaign Name" },
      },
      {
        type: "input",
        block_id: "template_block",
        element: { type: "external_select", action_id: "template", min_query_length: 1 },
        label: { type: "plain_text", text: "Template" },
      },
      {
        type: "input",
        block_id: "vars_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "vars",
          placeholder: { type: "plain_text", text: "var1, var2 (use {name} for lead name)" },
        },
        label: { type: "plain_text", text: "Variables" },
      },
      {
        type: "input",
        block_id: "source_block",
        optional: true,
        element: { type: "static_select", action_id: "source", options: SOURCE_OPTIONS },
        label: { type: "plain_text", text: "Source Filter" },
      },
      {
        type: "input",
        block_id: "status_block",
        optional: true,
        element: { type: "static_select", action_id: "status", options: STATUS_OPTIONS },
        label: { type: "plain_text", text: "Status Filter" },
      },
      {
        type: "input",
        block_id: "cooldown_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "cooldown", initial_value: "14" },
        label: { type: "plain_text", text: "Cooldown (days, min 7)" },
      },
    ],
  };
}

module.exports = {
  buildLeadAddModal,
  buildLeadMultiModal,
  buildLeadFilterModal,
  buildLeadSelectModal,
  buildCampaignNewModal,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
};
