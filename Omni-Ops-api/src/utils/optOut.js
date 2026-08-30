// كشف طلبات إيقاف الرسايل الترويجية
// الشرط: الرسالة كلها تكون كلمة إيقاف — مش مجرد وجودها جوه جملة،
// عشان "متبطلوش ترسلوا" ما تتحسبش طلب إيقاف

const STOP_WORDS = new Set([
  // عربي
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
  // إنجليزي
  "stop",
  "unsubscribe",
  "cancel",
  "quit",
  "end",
  "remove",
]);

const START_WORDS = new Set(["اشتراك", "ابدأ", "ابدا", "start", "subscribe", "resume"]);

/** بيوحّد النص: مسافات، تشكيل، همزات، علامات ترقيم */
function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "") // التشكيل
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
