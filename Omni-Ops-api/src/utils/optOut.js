// Detects requests to stop promotional messages.
// Condition: the entire message must be the stop word — not just present inside a sentence.

const STOP_WORDS = new Set([
  "إلغاء",
  "الغاء",
  "إيقاف",
  "ايقاف",
  "توقف",
  "وقف",
  "بطل",
  "بطلوا",
  "الغاء الاشتراك",
  "إلغاء الاشتراك",
  "لا اريد",
  "لا أريد",
  "كفاية",
  "stop",
  "unsubscribe",
  "cancel",
  "quit",
  "end",
  "remove",
]);

const START_WORDS = new Set(["اشتراك", "ابدأ", "ابدا", "start", "subscribe", "resume"]);

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "") // Arabic diacritics
    .replace(/[.،,!?؟*_-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOptOut(text) {
  return STOP_WORDS.has(normalizeText(text));
}

function isOptIn(text) {
  return START_WORDS.has(normalizeText(text));
}

module.exports = { isOptOut, isOptIn };
