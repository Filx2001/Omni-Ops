const crypto = require("crypto");

// Builds a signed PDF link that expires after a set number of days (default: 7)
function buildPdfUrl(invoiceId, days = 7) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const sig = crypto
    .createHmac("sha256", process.env.PDF_LINK_SECRET)
    .update(`${invoiceId}.${exp}`)
    .digest("hex");
  return `${process.env.API_PUBLIC_URL}/invoices/${invoiceId}/pdf?exp=${exp}&sig=${sig}`;
}

module.exports = { buildPdfUrl };
