// كلاينت بسيط لواتساب Cloud API — الإرسال بس
// Node 24 فيه fetch و FormData و Blob مدمجين، فمش محتاجين مكتبة زيادة

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

// حدود ميتا لكل نوع
const SIZE_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

// أنواع الهيدر اللي محتاجة ملف يتبعت مع كل رسالة
const MEDIA_HEADERS = ["IMAGE", "VIDEO", "DOCUMENT"];

function getConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set");
  }
  return { token, phoneNumberId };
}

/**
 * بيبعت رسالة نصية ويرجع الـ wamid بتاعها.
 * ملحوظة: ده بيشتغل جوه نافذة الـ 24 ساعة بس.
 * برا النافذة ميتا بترفض وبتطلب template معتمد.
 */
async function sendText(to, body) {
  const { token, phoneNumberId } = getConfig();
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to, // بيقبل الرقم بالكود الدولي، بـ + أو من غيرها
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = data?.error || {};
    throw new Error(
      `WhatsApp send failed [${response.status}] ${err.code || ""} ${err.message || "unknown error"}`.trim()
    );
  }

  return data?.messages?.[0]?.id || null;
}

/** بيرفع ملف لميتا ويرجع media id يتبعت بيه */
async function uploadMedia(blob, fileName, mimeType) {
  const { token, phoneNumberId } = getConfig();

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", blob, fileName);

  // مفيش Content-Type يدوي — fetch بيحطه مع الـ boundary لوحده
  const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    const err = data?.error || {};
    throw new Error(
      `WhatsApp upload failed [${response.status}] ${err.message || "unknown error"}`
    );
  }
  return data.id;
}

/**
 * بيبعت ميديا بالـ media id.
 * type: image | video | audio | document
 */
async function sendMedia(to, mediaId, type, caption = "", fileName = null) {
  const { token, phoneNumberId } = getConfig();

  const payload = { id: mediaId };
  // الصوت مبيقبلش كابشن
  if (caption && type !== "audio") payload.caption = caption;
  if (type === "document" && fileName) payload.filename = fileName;

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type,
        [type]: payload,
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error || {};
    throw new Error(
      `WhatsApp media send failed [${response.status}] ${err.message || "unknown error"}`
    );
  }
  return data?.messages?.[0]?.id || null;
}

/**
 * بيطلّع المتغيرات من نص القالب.
 * ميتا بتدعم شكلين: مرقّم {{1}} أو بأسماء {{customer_name}}.
 * الاتنين مختلفين في الإرسال، فلازم نفرّق بينهم من هنا.
 */
function parsePlaceholders(text) {
  const matches = String(text || "").match(/\{\{\s*([^}\s]+)\s*\}\}/g) || [];
  const names = [];

  for (const m of matches) {
    const key = m.replace(/[{}\s]/g, "");
    if (!names.includes(key)) names.push(key);
  }

  const named = names.some((n) => !/^\d+$/.test(n));
  return { names, count: names.length, named };
}

/**
 * بيقرا القوالب المعتمدة من ميتا مباشرة — مفيش أسماء مكتوبة في الكود.
 *
 * بيرجع تعريف كامل مش بس عدد متغيرات الـ body: نوع الهيدر، وهل الهيدر
 * محتاج ملف، وهل فيه أزرار بمتغيرات. من غير ده الحملة بتتعمل وتفشل
 * وقت الإرسال بكود 132012 بدل ما ترفض من البداية.
 */
async function getTemplates() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!token || !wabaId) throw new Error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_WABA_ID is not set");

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates?limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error || {};
    throw new Error(`Failed to load templates [${response.status}] ${err.message || "unknown"}`);
  }

  const all = data.data || [];
  return (
    all
      // ميتا بتستخدم حالات فرعية زي "Active - Quality pending" وهي معتمدة وشغالة.
      // الرفض بيبقى REJECTED أو PENDING (لسه تحت المراجعة).
      .filter((t) => !["REJECTED", "PENDING", "PENDING_DELETION", "DISABLED"].includes(t.status))
      .map((t) => {
        const components = t.components || [];

        const body = components.find((c) => c.type === "BODY");
        const header = components.find((c) => c.type === "HEADER");
        const buttons = components.find((c) => c.type === "BUTTONS");

        const bodyText = body?.text || "";
        const bodyVars = parsePlaceholders(bodyText);

        const headerFormat = header?.format || null; // IMAGE · VIDEO · DOCUMENT · TEXT · null
        const headerVars = parsePlaceholders(header?.text || "");

        // زرار URL ديناميكي بياخد متغير كمان
        const buttonVariableCount = (buttons?.buttons || []).filter(
          (b) => b.type === "URL" && /\{\{/.test(b.url || "")
        ).length;

        return {
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          bodyText,

          // متغيرات الـ body
          variableCount: bodyVars.count,
          variableNames: bodyVars.names,
          usesNamedParams: bodyVars.named,

          // الهيدر
          headerFormat,
          // محتاج ملف يتبعت مع كل رسالة (صورة/فيديو/ملف)
          headerNeedsMedia: MEDIA_HEADERS.includes(headerFormat || ""),
          // هيدر نصي فيه متغير
          headerVariableCount: headerFormat === "TEXT" ? headerVars.count : 0,

          hasButtons: Boolean(buttons),
          buttonVariableCount,
        };
      })
  );
}

/**
 * بيبعت قالب معتمد — ده الطريق الوحيد للإرسال برا نافذة الـ 24 ساعة.
 *
 * options:
 *   headerMediaId   — media id من uploadMedia لقوالب هيدر الصورة/الفيديو/الملف
 *   headerMediaLink — بديل: رابط عام للملف
 *   headerFormat    — IMAGE | VIDEO | DOCUMENT (محتاج مع الميديا)
 *   variableNames   — أسماء المتغيرات لو القالب بيستخدم {{name}} مش {{1}}
 */
async function sendTemplate(to, templateName, language = "en", variables = [], options = {}) {
  const { token, phoneNumberId } = getConfig();
  const { headerMediaId, headerMediaLink, headerFormat, variableNames = null } = options;

  const components = [];

  // ---------- الهيدر ----------
  if (headerFormat && MEDIA_HEADERS.includes(headerFormat)) {
    if (!headerMediaId && !headerMediaLink) {
      throw new Error(
        `Template "${templateName}" has a ${headerFormat} header but no media was provided`
      );
    }

    const key = headerFormat.toLowerCase(); // image · video · document
    components.push({
      type: "header",
      parameters: [
        {
          type: key,
          [key]: headerMediaId ? { id: headerMediaId } : { link: headerMediaLink },
        },
      ],
    });
  }

  // ---------- الـ body ----------
  if (variables.length > 0) {
    components.push({
      type: "body",
      parameters: variables.map((v, i) => {
        const param = { type: "text", text: String(v) };
        // القوالب بالمتغيرات المسماة محتاجة parameter_name مع كل قيمة
        if (variableNames && variableNames[i] && !/^\d+$/.test(variableNames[i])) {
          param.parameter_name = variableNames[i];
        }
        return param;
      }),
    });
  }

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error || {};
    // الكود مهم — المحرك بيفرّق بين حد يومي وفشل حقيقي
    throw new Error(
      `Template send failed [${response.status}] ${err.code || ""} ${err.message || "unknown error"}`.trim()
    );
  }

  return data?.messages?.[0]?.id || null;
}

module.exports = {
  sendText,
  uploadMedia,
  sendMedia,
  getTemplates,
  sendTemplate,
  parsePlaceholders,
  SIZE_LIMITS,
  MEDIA_HEADERS,
};
