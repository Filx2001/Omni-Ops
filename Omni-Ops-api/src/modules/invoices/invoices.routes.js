const express = require("express");
const router = express.Router();
const InvoiceService = require("./invoices.service");
const prisma = require("../../prisma");
const crypto = require("crypto");

// HTML-escape user data rendered into the PDF page
const escapeHtml = (str) =>
  String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );

router.post("/", async (req, res) => {
  try {
    const invoice = await InvoiceService.createInvoice(req.workspace.id, req.body);
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await InvoiceService.getAllInvoices(req.workspace.id, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const updated = await InvoiceService.updateInvoiceStatus(
      req.workspace.id,
      req.params.id,
      req.body.status
    );
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    res.json(await InvoiceService.deleteInvoice(req.workspace.id, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Email the invoice to a customer
router.post("/:id/send", async (req, res) => {
  try {
    const { email } = req.body;
    await InvoiceService.sendInvoiceEmail(req.workspace, req.params.id, email);
    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("❌ EMAIL ERROR DETAILS:", error);
    res.status(500).json({ error: error.message });
  }
});

// Signed, expiring PDF link — verifies its own signature (no API key / workspace header needed)
router.get("/:id/pdf", async (req, res) => {
  try {
    const { exp, sig } = req.query;
    if (!exp || !sig) return res.status(401).send("Invalid link");
    if (Date.now() > parseInt(exp))
      return res.status(410).send("This link has expired. Please generate a new one from Discord.");

    const expected = crypto
      .createHmac("sha256", process.env.PDF_LINK_SECRET)
      .update(`${req.params.id}.${exp}`)
      .digest("hex");

    const sigBuf = Buffer.from(String(sig));
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(401).send("Invalid link");
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { createdBy: { select: { name: true } }, workspace: true },
    });

    if (!invoice) {
      console.error(`❌ PDF Error: Invoice with ID ${req.params.id} not found.`);
      return res.status(404).send("Invoice not found");
    }

    const currency = invoice.workspace?.currency || "USD";
    const orgName = invoice.workspace?.organizationName || "Omni-Ops";
    const issueDate = new Date(invoice.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const grossAmount = invoice.amount * invoice.quantity;
    const issuedBy = invoice.issuedByName || invoice.createdBy?.name || "System";

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: auto; padding: 24px;">
  <h1 style="text-align:center; margin:0;">${escapeHtml(orgName)}</h1>
  <p style="text-align:center; color:#555;">Official Invoice</p>
  <p><strong>Name:</strong> ${escapeHtml(invoice.customerName)}</p>
  <p><strong>Invoice No:</strong> INV-${escapeHtml(invoice.invoiceNumber)}</p>
  <p><strong>Date:</strong> ${escapeHtml(issueDate)}</p>
  <p><strong>Issued By:</strong> ${escapeHtml(issuedBy)}</p>
  <table style="width:100%; border-collapse:collapse; margin-top:16px;">
    <tr style="background:#eee;">
      <th style="padding:10px; border:1px solid #ccc; text-align:left;">Description</th>
      <th style="padding:10px; border:1px solid #ccc;">Unit Price</th>
      <th style="padding:10px; border:1px solid #ccc;">Qty</th>
      <th style="padding:10px; border:1px solid #ccc;">Gross</th>
    </tr>
    <tr>
      <td style="padding:10px; border:1px solid #ccc;">
        ${escapeHtml(invoice.category)}${invoice.description ? ` — ${escapeHtml(invoice.description)}` : ""}
      </td>
      <td style="padding:10px; border:1px solid #ccc; text-align:center;">${currency} ${escapeHtml(invoice.amount)}</td>
      <td style="padding:10px; border:1px solid #ccc; text-align:center;">${escapeHtml(invoice.quantity)}</td>
      <td style="padding:10px; border:1px solid #ccc; text-align:center;">${currency} ${escapeHtml(grossAmount)}</td>
    </tr>
  </table>
  ${invoice.discount > 0 ? `<p style="text-align:right;">Discount: ${escapeHtml(invoice.discount)}%</p>` : ""}
  <h2 style="text-align:right;">Net Total: ${escapeHtml(invoice.netAmount)} ${currency}</h2>
</div>`;
    res.send(html);
  } catch (error) {
    console.error("❌ PDF GENERATION ERROR:", error);
    res.status(500).send("Error generating PDF: " + error.message);
  }
});

module.exports = router;
