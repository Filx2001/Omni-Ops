const googleAuth = require("./googleAuth");

const sheetId = (ws) => ws?.googleAccountingSheetId || process.env.ACCOUNTING_SHEET_ID;
const invoiceRow = (i) => [
  `INV-${i.invoiceNumber ?? i.id}`,
  i.customerName || "",
  i.category || "",
  i.description || "",
  i.quantity ?? 1,
  i.discount ?? 0,
  i.netAmount ?? "",
  i.status || "",
  i.createdAt ? new Date(i.createdAt).toISOString() : "",
];

async function syncInvoiceToAccountingSheet(invoice) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(invoice.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return;
    await googleAuth.appendRow(ctx.auth, id, "Invoices", invoiceRow(invoice));
  } catch (e) {
    console.error("[Accounting] invoice sync failed:", e.message);
  }
}

async function removeInvoiceFromAccountingSheet(invoice) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(invoice.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return;
    const invoiceRef = `INV-${invoice.invoiceNumber ?? invoice.id}`;
    await googleAuth.deleteRowByValue(ctx.auth, id, "Invoices", 0, invoiceRef);
  } catch (e) {
    console.error("[Accounting] invoice remove failed:", e.message);
  }
}

async function backfillAccountingSheet(invoices) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(invoices[0]?.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return 0;
    await googleAuth.rewriteTab(ctx.auth, id, "Invoices", [
      googleAuth.INVOICE_HEADER,
      ...invoices.map(invoiceRow),
    ]);
    return invoices.length;
  } catch (e) {
    console.error("[Accounting] backfill failed:", e.message);
    return 0;
  }
}

module.exports = {
  syncInvoiceToAccountingSheet,
  removeInvoiceFromAccountingSheet,
  backfillAccountingSheet,
};
