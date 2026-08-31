const crypto = require("crypto");
const ALGO = "aes-256-gcm";

function getKey() {
  const secret =
    process.env.SECRET_ENCRYPTION_KEY || process.env.INTERNAL_API_KEY || "omni-ops-dev-secret";
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(payload) {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    return payload; // legacy plaintext value
  }
}

module.exports = { encrypt, decrypt };
