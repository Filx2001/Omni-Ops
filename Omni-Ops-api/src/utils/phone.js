// تطبيع أرقام التليفون لصيغة E.164 موحدة (+97455512345)
// نقطة واحدة بس عشان نمنع تسجيل نفس العميل مرتين بصيغتين مختلفتين

const DEFAULT_COUNTRY_CODE = "974"; // قطر

// أرقام الموبايل القطرية: 8 أرقام بتبدأ بـ 3 أو 5 أو 6 أو 7
const QATAR_MOBILE = /^[3567]\d{7}$/;

/**
 * بيرجع الرقم بصيغة +<كود الدولة><الرقم>، أو null لو مش صالح.
 * واتساب بيبعت الرقم بالكود الدولي من غير +، فدي بتزوده.
 * الافتراض القطري بيشتغل بس مع الأرقام المحلية اللي بتتسجل يدوي.
 */
function normalizePhone(input) {
  if (input === null || input === undefined) return null;

  let digits = String(input).replace(/\D/g, "");
  if (!digits) return null;

  // صيغة الاتصال الدولي 00974... → 974...
  if (digits.startsWith("00")) digits = digits.slice(2);

  // رقم قطري محلي من غير كود دولة
  if (QATAR_MOBILE.test(digits)) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }

  // حدود E.164
  if (digits.length < 8 || digits.length > 15) return null;

  return "+" + digits;
}

/** مقارنة رقمين بغض النظر عن الصيغة (مفيدة للشيت والبحث) */
function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && na === nb;
}

module.exports = { normalizePhone, samePhone };
