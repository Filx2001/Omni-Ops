// Invoices → per-workspace "Accounting" sheet, monthly tabs.
// The bot owns the data columns; humans own "Payment" + "Notes" (never overwritten on update).
const engine = require("./sheetEngine");

const HEADERS = [
  "Invoice #",
  "Customer",
  "Category",
  "Description",
  "Qty",
  "Discount %",
  "Net",
  "Status",
  "Issued At",
  "Payment",
  "Notes",
  "Record ID",
];

function dataPayload(inv, tz) {
  return {
    "Invoice #": `INV-${inv.invoiceNumber ?? inv.id}`,
    Customer: inv.customerName || "",
    Category: inv.category || "",
    Description: inv.description || "",
    Qty: String(inv.quantity ?? 1),
    "Discount %": String(inv.discount ?? 0),
    Net: String(inv.netAmount ?? ""),
    Status: inv.status || "",
    "Issued At": engine.fmtDateTime(inv.createdAt, tz),
    "Record ID": inv.id,
  };
}

async function syncInvoiceToAccountingSheet(invoice) {
  if (!invoice?.id) return;
  try {
    const ctx = await engine.getSheetContext(invoice.workspaceId, "googleAccountingSheetId");
    if (!ctx) return;
    const tz = ctx.ws.timezone;
    await engine.withDoc(invoice.workspaceId, ctx.ws.googleAccountingSheetId, async (doc) => {
      const payload = dataPayload(invoice, tz);
      let found = null;
      for (const sheet of doc.sheetsByIndex) {
        let rows = [];
        try {
          rows = await sheet.getRows();
        } catch {
          continue;
        }
        const row = rows.find((r) => r.get("Record ID") === invoice.id);
        if (row) {
          found = row;
          break;
        }
      }
      if (found) {
        found.assign(payload); // Payment & Notes stay untouched
        await found.save();
      } else {
        const sheet = await engine.getOrCreateTab(
          doc,
          engine.monthTitle(invoice.createdAt, tz),
          HEADERS
        );
        await sheet.addRow({ ...payload, Payment: "", Notes: "" });
      }
    });
  } catch (err) {
    console.error("[Accounting] invoice sync failed:", err.message);
  }
}

async function removeInvoiceFromAccountingSheet(invoice) {
  if (!invoice?.id) return;
  try {
    const ctx = await engine.getSheetContext(invoice.workspaceId, "googleAccountingSheetId");
    if (!ctx) return;
    await engine.withDoc(invoice.workspaceId, ctx.ws.googleAccountingSheetId, async (doc) => {
      for (const sheet of doc.sheetsByIndex) {
        let rows = [];
        try {
          rows = await sheet.getRows();
        } catch {
          continue;
        }
        const row = rows.find((r) => r.get("Record ID") === invoice.id);
        if (row) {
          await row.delete();
          return;
        }
      }
    });
  } catch (err) {
    console.error("[Accounting] invoice remove failed:", err.message);
  }
}

// Smart rebuild: upserts every invoice, deletes stale rows, KEEPS manual Payment/Notes
async function backfillAccountingSheet(invoices) {
  if (!invoices?.length) return 0;
  const wsId = invoices[0].workspaceId;
  const ctx = await engine.getSheetContext(wsId, "googleAccountingSheetId");
  if (!ctx) return 0;
  const tz = ctx.ws.timezone;
  let touched = 0;
  await engine.withDoc(wsId, ctx.ws.googleAccountingSheetId, async (doc) => {
    const dbIds = new Set(invoices.map((i) => i.id));
    for (const sheet of doc.sheetsByIndex) {
      if (!engine.isMonthTab(sheet.title)) continue;
      const rows = await sheet.getRows().catch(() => []);
      for (const row of rows) {
        const id = row.get("Record ID");
        if (id && !dbIds.has(id)) await row.delete();
      }
    }
    for (const inv of invoices) {
      const sheet = await engine.getOrCreateTab(doc, engine.monthTitle(inv.createdAt, tz), HEADERS);
      const rows = await sheet.getRows().catch(() => []);
      const row = rows.find((r) => r.get("Record ID") === inv.id);
      const payload = dataPayload(inv, tz);
      if (row) {
        row.assign(payload);
        await row.save();
      } else await sheet.addRow({ ...payload, Payment: "", Notes: "" });
      touched++;
    }
  });
  return touched;
}

module.exports = {
  syncInvoiceToAccountingSheet,
  removeInvoiceFromAccountingSheet,
  backfillAccountingSheet,
};
