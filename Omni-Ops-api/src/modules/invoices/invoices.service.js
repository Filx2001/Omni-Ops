const prisma = require("../../prisma");
const { Resend } = require("resend");
const {
  syncInvoiceToAccountingSheet,
  removeInvoiceFromAccountingSheet,
} = require("../../integrations/accountingSheets");

// Optional integration — the module works without it
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// HTML-escape any user-provided data that ends up in the email
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

const InvoiceService = {
  async createInvoice(workspaceId, data) {
    const amount = parseFloat(data.amount);
    const quantity = parseInt(data.quantity) || 1;
    const discount = parseInt(data.discount) || 0;
    const grossAmount = amount * quantity;
    const discountAmount = (discount / 100) * grossAmount;
    const netAmount = grossAmount - discountAmount;

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId,
        customerName: data.customerName,
        category: data.category,
        description: data.description || "",
        amount,
        quantity,
        discount,
        netAmount,
        status: data.status || "PENDING",
        createdById: data.createdById,
        issuedByName: data.issuedByName || null,
      },
    });

    // Sync to Google Accounting Sheet
    syncInvoiceToAccountingSheet(invoice).catch((err) =>
      console.error("[Accounting] Invoice sync failed:", err.message)
    );

    return invoice;
  },

  // Supports search + totals, scoped to the workspace
  async getAllInvoices(workspaceId, filters = {}) {
    const { invoiceNo, month, year, startDate, endDate } = filters;
    const where = { workspaceId };

    if (invoiceNo) {
      // Strip the "INV-" prefix if the user typed it, so we search by number
      where.invoiceNumber = parseInt(invoiceNo.replace(/INV-/i, ""));
    }
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + "T23:59:59.999Z"), // end of day
      };
    } else if (month) {
      const queryYear = year ? parseInt(year) : new Date().getFullYear();
      const queryMonth = parseInt(month);
      const start = new Date(queryYear, queryMonth - 1, 1);
      const end = new Date(queryYear, queryMonth, 0, 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });

    const totalAmount = invoices.reduce((sum, inv) => sum + inv.netAmount, 0);
    return { invoices, totalAmount };
  },

  async updateInvoiceStatus(workspaceId, id, status) {
    return await prisma.invoice.update({ where: { id, workspaceId }, data: { status } });
  },

  async deleteInvoice(workspaceId, id) {
    // Fetch first so we have the invoiceNumber to remove it from the Google Sheet
    const invoice = await prisma.invoice.findUnique({ where: { id, workspaceId } });
    if (!invoice) throw new Error("Invoice not found");

    await prisma.invoice.delete({ where: { id, workspaceId } });

    // Remove from Google Accounting Sheet
    removeInvoiceFromAccountingSheet(invoice).catch((err) =>
      console.error("[Accounting] Invoice remove failed:", err.message)
    );

    return invoice;
  },

  async sendInvoiceEmail(workspace, invoiceId, clientEmail) {
    if (!resend) {
      throw new Error(
        "Email sending is not configured. Set RESEND_API_KEY (and optionally EMAIL_FROM)."
      );
    }
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: workspace.id },
      include: { createdBy: { select: { name: true } } },
    });
    if (!invoice) throw new Error("Invoice not found");

    const currency = workspace.currency || "USD";
    const orgName = workspace.organizationName || "Omni-Ops";
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

    const descriptionHtml = invoice.description
      ? `<br><span style="font-size: 13px; color: #718096;">${escapeHtml(invoice.description)}</span>`
      : "";
    const discountHtml =
      invoice.discount > 0
        ? `<p style="margin: 5px 0; color: #4a5568;">Discount: <strong>${escapeHtml(invoice.discount)}%</strong></p>`
        : "";

    const fromAddress = process.env.EMAIL_FROM || "onboarding@resend.dev";
    const { data, error } = await resend.emails.send({
      from: `${orgName} <${fromAddress}>`,
      to: clientEmail,
      subject: `Invoice INV-${invoice.invoiceNumber} from ${orgName}`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
  <div style="background-color: #1a202c; color: white; padding: 20px; text-align: center;">
    <h2 style="margin: 0; font-size: 24px;">${escapeHtml(orgName)}</h2>
    <p style="color: #a0aec0; margin: 5px 0 0 0;">OFFICIAL INVOICE</p>
  </div>
  <div style="padding: 20px; background-color: #f7fafc;">
    <p><strong>Invoice To:</strong> ${escapeHtml(invoice.customerName)}</p>
    <p><strong>Invoice No:</strong> INV-${escapeHtml(invoice.invoiceNumber)}</p>
    <p><strong>Date & Time:</strong> ${escapeHtml(issueDate)} - ${escapeHtml(issueTime)}</p>
    <p><strong>Issued By:</strong> ${escapeHtml(invoice.issuedByName || invoice.createdBy?.name || "System")}</p>
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
        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${invoice.quantity}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${grossAmount} ${currency}</td>
      </tr>
    </table>
    <div style="margin-top: 20px; text-align: right; border-top: 2px solid #e2e8f0; padding-top: 15px;">
      ${discountHtml}
      <h3 style="color: #2b6cb0; margin: 10px 0; font-size: 22px;">Net Total: ${invoice.netAmount} ${currency}</h3>
    </div>
  </div>
</div>`,
    });
    if (error) throw new Error(error.message);
    return true;
  },
};

module.exports = InvoiceService;
