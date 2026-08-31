// Normalizes phone numbers to a unified E.164 format (+XXXXXXXXXXX).
// Single source of truth to prevent registering the same customer twice in different formats.
//
// Configuration via .env (optional):
//   DEFAULT_COUNTRY_CODE=974      (e.g. Qatar=974, US=1, UK=44)
//   LOCAL_NUMBER_LENGTH=8         (length of local mobile numbers to auto-prepend country code)
//
// WhatsApp sends numbers with the international code but without the '+'.
// The local default only applies to manually entered local numbers.

const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || "").replace(/\D/g, "");
const LOCAL_NUMBER_LENGTH = parseInt(process.env.LOCAL_NUMBER_LENGTH || "0", 10) || null;

// Build a regex for local mobile numbers if configured (e.g. /^\d{8}$/)
const LOCAL_REGEX = LOCAL_NUMBER_LENGTH ? new RegExp(`^\\d{${LOCAL_NUMBER_LENGTH}}$`) : null;

function normalizePhone(input) {
  if (input === null || input === undefined) return null;

  let digits = String(input).replace(/\D/g, "");
  if (!digits) return null;

  // International dialing prefix 00974... -> 974...
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Local number without country code
  if (LOCAL_REGEX && DEFAULT_COUNTRY_CODE && LOCAL_REGEX.test(digits)) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }

  // E.164 limits
  if (digits.length < 8 || digits.length > 15) return null;

  return "+" + digits;
}

// Compare two numbers regardless of format (useful for sheets and search)
function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && na === nb;
}

module.exports = { normalizePhone, samePhone };
