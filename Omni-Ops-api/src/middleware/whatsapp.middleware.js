// Verifies that the request actually came from Meta, not just anyone who knows the URL.
const crypto = require("crypto");

function verifyWhatsAppSignature(req, res, next) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    console.error("[WhatsApp] WHATSAPP_APP_SECRET is not set - webhook is locked");
    return res.sendStatus(403);
  }

  if (!req.rawBody) {
    console.error("[WhatsApp] rawBody is missing - check express.json verify hook in app.js");
    return res.sendStatus(403);
  }

  const header = req.get("x-hub-signature-256");
  if (!header || !header.startsWith("sha256=")) {
    console.warn("[WhatsApp] Request rejected: missing or malformed signature header");
    return res.sendStatus(403);
  }

  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");

  const received = Buffer.from(header);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length || !crypto.timingSafeEqual(received, computed)) {
    console.warn("[WhatsApp] Request rejected: signature mismatch");
    return res.sendStatus(403);
  }

  next();
}

module.exports = { verifyWhatsAppSignature };
//
