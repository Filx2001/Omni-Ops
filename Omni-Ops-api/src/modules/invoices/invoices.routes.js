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
    const deleted = await InvoiceService.deleteInvoice(req.workspace.id, req.params.id);
    res.json(deleted);
  } catch (error) {
    if (error.message === "Invoice not found")
      return res.status(404).json({ error: error.message });
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
    const issueTime = new Date(invoice.createdAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const grossAmount = invoice.amount * invoice.quantity;
    const issuedBy = invoice.issuedByName || invoice.createdBy?.name || "System";

    const descriptionHtml = invoice.description
      ? `<br><span style="font-size: 13px; color: #718096;">${escapeHtml(invoice.description)}</span>`
      : "";
    const discountHtml =
      invoice.discount > 0
        ? `<p style="margin: 5px 0; color: #4a5568;">Discount: <strong>${escapeHtml(invoice.discount)}%</strong></p>`
        : "";

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
  <div style="background-color: #1a202c; color: white; padding: 20px; text-align: center;">
    <h2 style="margin: 0; font-size: 24px;">${escapeHtml(orgName)}</h2>
    <p style="color: #a0aec0; margin: 5px 0 0 0;">OFFICIAL INVOICE</p>
  </div>
  <div style="padding: 20px; background-color: #f7fafc;">
    <p><strong>Invoice To:</strong> ${escapeHtml(invoice.customerName)}</p>
    <p><strong>Invoice No:</strong> INV-${escapeHtml(invoice.invoiceNumber)}</p>
    <p><strong>Date & Time:</strong> ${escapeHtml(issueDate)} - ${escapeHtml(issueTime)}</p>
    <p><strong>Issued By:</strong> ${escapeHtml(issuedBy)}</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: white;">
      <tr style="background-color: #cbd5e0; color: #2d3748;">
        <th style="padding: 12px; border: 1px solid #e2e8f0;">Description</th>
        <th style="padding: 12px; border: 1px solid #e2e8f0;">Qty</th>
        <th style="padding: 12px; border: 1px solid #e2e8f0;">Gross Amount</th>
      </tr>
      <tr>
        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">
          <strong>${escapeHtml(invoice.category)}</strong>${descriptionHtml}
        </td>
        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${escapeHtml(invoice.quantity)}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${grossAmount.toLocaleString()} ${currency}</td>
      </tr>
    </table>
    <div style="margin-top: 20px; text-align: right; border-top: 2px solid #e2e8f0; padding-top: 15px;">
      ${discountHtml}
      <h3 style="color: #2b6cb0; margin: 10px 0; font-size: 22px;">Net Total: ${invoice.netAmount.toLocaleString()} ${currency}</h3>
    </div>
  </div>
</div>`;
    res.send(html);
  } catch (error) {
    console.error("❌ PDF GENERATION ERROR:", error);
    res.status(500).send("Error generating PDF: " + error.message);
  }
});

module.exports = router;
