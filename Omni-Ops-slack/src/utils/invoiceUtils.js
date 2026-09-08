const { buildPdfUrl } = require("./pdfLink");

const STATUS_MAP = { PENDING: "⏳ Pending", PAID: "✅ Paid", CANCELLED: "❌ Cancelled" };

function formatInvoiceBlocks(invoice, action = "create") {
  const header =
    action === "create"
      ? "✅ Invoice Created"
      : action === "update"
        ? "🔄 Invoice Updated"
        : "🗑️ Invoice Deleted";
  const gross = invoice.amount * invoice.quantity;
  const pdfUrl = buildPdfUrl(invoice.id);

  const blocks = [
    { type: "header", text: { type: "plain_text", text: header } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Invoice No*\nINV-${invoice.invoiceNumber}` },
        { type: "mrkdwn", text: `*Client*\n${invoice.customerName}` },
        { type: "mrkdwn", text: `*Service*\n${invoice.category}` },
        { type: "mrkdwn", text: `*Status*\n${STATUS_MAP[invoice.status] || invoice.status}` },
        { type: "mrkdwn", text: `*Gross*\n${gross.toLocaleString()}` },
        { type: "mrkdwn", text: `*Net Total*\n*${invoice.netAmount.toLocaleString()}*` },
      ],
    },
  ];

  if (invoice.discount > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `🔻 Discount: ${invoice.discount}%` }],
    });
  }

  const actions = [];
  if (action !== "delete") {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "✉️ Send Email" },
      action_id: `invoice_email_btn:${invoice.id}`,
    });
    if (pdfUrl)
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "📄 View PDF" },
        url: pdfUrl,
      });
  }

  if (actions.length) blocks.push({ type: "actions", elements: actions });
  return blocks;
}

function formatInvoiceListBlocks(invoices, totalAmount) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "📊 Invoices Report" } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Total Net Amount:* ${totalAmount.toLocaleString()} 💰` },
    },
  ];

  invoices.slice(0, 15).forEach((inv) => {
    const date = new Date(inv.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });
    const status = STATUS_MAP[inv.status] || "⏳";
    const pdfUrl = buildPdfUrl(inv.id);
    const pdfLink = pdfUrl ? ` • <${pdfUrl}|PDF>` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`[${date}]\` *INV-${inv.invoiceNumber}* | ${inv.customerName} | *${inv.netAmount.toLocaleString()}* ${status}${pdfLink}`,
      },
    });
  });

  if (invoices.length > 15) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Showing latest 15 out of ${invoices.length} invoices.` }],
    });
  }
  return blocks;
}

module.exports = { formatInvoiceBlocks, formatInvoiceListBlocks, STATUS_MAP };
