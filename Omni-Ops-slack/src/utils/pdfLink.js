const crypto = require("crypto");

/** Builds a signed, 1-hour expiring URL for the invoice PDF endpoint. */
function buildPdfUrl(invoiceId) {
  const secret = process.env.PDF_LINK_SECRET;
  const baseUrl = process.env.API_PUBLIC_URL || process.env.API_URL;
  if (!secret || !baseUrl || !invoiceId) return null;
  const exp = Date.now() + 60 * 60 * 1000;
  const sig = crypto.createHmac("sha256", secret).update(`${invoiceId}.${exp}`).digest("hex");
  return `${baseUrl.replace(/\/$/, "")}/invoices/${invoiceId}/pdf?exp=${exp}&sig=${sig}`;
}

module.exports = { buildPdfUrl };
