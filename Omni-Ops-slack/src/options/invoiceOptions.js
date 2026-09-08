const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");

async function handleInvoiceOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();
  try {
    const res = await runWithTenant(workspaceId, () => axios.get(`/invoices`));
    const invoices = res.data.invoices || res.data || [];
    const filtered = invoices
      .filter((b) => {
        const ref = `INV-${b.invoiceNumber}`.toLowerCase();
        const name = (b.customerName || "").toLowerCase();
        return ref.includes(search) || name.includes(search);
      })
      .slice(0, 25);

    await ack({
      options: filtered.map((b) => {
        const statusIcon = b.status === "PAID" ? "✅" : b.status === "CANCELLED" ? "❌" : "⏳";
        return {
          text: {
            type: "plain_text",
            text: `INV-${b.invoiceNumber} | ${b.customerName} (${b.netAmount}) ${statusIcon}`.substring(
              0,
              75
            ),
          },
          value: b.id,
        };
      }),
    });
  } catch (err) {
    console.error("Invoice options error:", err.message);
    await ack({ options: [] });
  }
}

module.exports = { handleInvoiceOptions };
