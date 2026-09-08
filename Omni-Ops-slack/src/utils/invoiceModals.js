const CATEGORY_OPTIONS = [
  { text: { type: "plain_text", text: "🏕️ Camp / Workshop" }, value: "Workshop" },
  { text: { type: "plain_text", text: "📚 Course / Training" }, value: "Course" },
  { text: { type: "plain_text", text: "💼 Consulting" }, value: "Consulting" },
  { text: { type: "plain_text", text: "🛠️ Service / Product" }, value: "Service" },
];

const DISCOUNT_OPTIONS = [
  { text: { type: "plain_text", text: "No discount" }, value: "0" },
  { text: { type: "plain_text", text: "5%" }, value: "5" },
  { text: { type: "plain_text", text: "10%" }, value: "10" },
  { text: { type: "plain_text", text: "15%" }, value: "15" },
  { text: { type: "plain_text", text: "20%" }, value: "20" },
];

const STATUS_OPTIONS = [
  { text: { type: "plain_text", text: "⏳ Pending" }, value: "PENDING" },
  { text: { type: "plain_text", text: "✅ Paid" }, value: "PAID" },
  { text: { type: "plain_text", text: "❌ Cancelled" }, value: "CANCELLED" },
];

function buildCreateInvoiceModal() {
  return {
    type: "modal",
    callback_id: "invoice_create_modal",
    title: { type: "plain_text", text: "Create Invoice" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name_block",
        element: { type: "plain_text_input", action_id: "name" },
        label: { type: "plain_text", text: "Client Name" },
      },
      {
        type: "input",
        block_id: "category_block",
        element: { type: "static_select", action_id: "category", options: CATEGORY_OPTIONS },
        label: { type: "plain_text", text: "Service Type" },
      },
      {
        type: "input",
        block_id: "amount_block",
        element: { type: "plain_text_input", action_id: "amount" },
        label: { type: "plain_text", text: "Unit Price" },
      },
      {
        type: "input",
        block_id: "qty_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "qty", initial_value: "1" },
        label: { type: "plain_text", text: "Quantity" },
      },
      {
        type: "input",
        block_id: "discount_block",
        optional: true,
        element: { type: "static_select", action_id: "discount", options: DISCOUNT_OPTIONS },
        label: { type: "plain_text", text: "Discount" },
      },
      {
        type: "input",
        block_id: "desc_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "desc", multiline: true },
        label: { type: "plain_text", text: "Description" },
      },
    ],
  };
}

function buildStatusInvoiceModal() {
  return {
    type: "modal",
    callback_id: "invoice_status_modal",
    title: { type: "plain_text", text: "Update Status" },
    submit: { type: "plain_text", text: "Update" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: { type: "external_select", action_id: "invoice", min_query_length: 1 },
        label: { type: "plain_text", text: "Invoice" },
      },
      {
        type: "input",
        block_id: "status_block",
        element: { type: "static_select", action_id: "status", options: STATUS_OPTIONS },
        label: { type: "plain_text", text: "New Status" },
      },
    ],
  };
}

function buildDeleteInvoiceModal() {
  return {
    type: "modal",
    callback_id: "invoice_delete_modal",
    title: { type: "plain_text", text: "Delete Invoice" },
    submit: { type: "plain_text", text: "Delete" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: { type: "external_select", action_id: "invoice", min_query_length: 1 },
        label: { type: "plain_text", text: "Invoice" },
      },
    ],
  };
}

function buildEmailInvoiceModal(invoiceId) {
  return {
    type: "modal",
    callback_id: `invoice_email_modal:${invoiceId}`,
    title: { type: "plain_text", text: "Send Invoice" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "email_block",
        element: {
          type: "plain_text_input",
          action_id: "email",
          placeholder: { type: "plain_text", text: "client@example.com" },
        },
        label: { type: "plain_text", text: "Client Email Address" },
      },
    ],
  };
}

module.exports = {
  buildCreateInvoiceModal,
  buildStatusInvoiceModal,
  buildDeleteInvoiceModal,
  buildEmailInvoiceModal,
};
