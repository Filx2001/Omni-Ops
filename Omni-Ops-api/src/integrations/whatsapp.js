// Simple WhatsApp Cloud API client — sending only.
// Node 18+ has fetch, FormData and Blob built-in, no extra libraries needed.

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

// Meta limits per type
const SIZE_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

// Header types that require a file attached to every message
const MEDIA_HEADERS = ["IMAGE", "VIDEO", "DOCUMENT"];

function getConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set");
  }
  return { token, phoneNumberId };
}

// Sends a text message and returns the wamid.
// Note: This only works inside the 24-hour window.
// Outside the window Meta rejects it and requires an approved template.
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
      to,
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

// Uploads a file to Meta and returns the media id to send with
async function uploadMedia(blob, fileName, mimeType) {
  const { token, phoneNumberId } = getConfig();

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", blob, fileName);

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

// Sends media by media id. type: image | video | audio | document
async function sendMedia(to, mediaId, type, caption = "", fileName = null) {
  const { token, phoneNumberId } = getConfig();

  const payload = { id: mediaId };
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

// Extracts variables from template text.
// Meta supports two formats: numbered {{1}} or named {{customer_name}}.
// They are sent differently, so we must distinguish them here.
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

// Reads approved templates directly from Meta — no hardcoded names.
// Returns a full definition, not just body variable count: header type,
// whether header needs a file, and button variables. Without this,
// campaigns fail at send time with code 132012 instead of being rejected early.
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
      // Meta uses sub-statuses like "Active - Quality pending" which are approved and working.
      // Rejection is REJECTED or PENDING (still under review).
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

        // Dynamic URL button that also takes a variable
        const buttonVariableCount = (buttons?.buttons || []).filter(
          (b) => b.type === "URL" && /\{\{/.test(b.url || "")
        ).length;

        return {
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          bodyText,
          variableCount: bodyVars.count,
          variableNames: bodyVars.names,
          usesNamedParams: bodyVars.named,
          headerFormat,
          headerNeedsMedia: MEDIA_HEADERS.includes(headerFormat || ""),
          headerVariableCount: headerFormat === "TEXT" ? headerVars.count : 0,
          hasButtons: Boolean(buttons),
          buttonVariableCount,
        };
      })
  );
}

// Sends an approved template — the only way to send outside the 24h window.
// options:
//   headerMediaId   — media id from uploadMedia for image/video/document headers
//   headerMediaLink — alternative: public URL for the file
//   headerFormat    — IMAGE | VIDEO | DOCUMENT (required with media)
//   variableNames   — variable names if template uses {{name}} instead of {{1}}
async function sendTemplate(to, templateName, language = "en", variables = [], options = {}) {
  const { token, phoneNumberId } = getConfig();
  const { headerMediaId, headerMediaLink, headerFormat, variableNames = null } = options;

  const components = [];

  if (headerFormat && MEDIA_HEADERS.includes(headerFormat)) {
    if (!headerMediaId && !headerMediaLink) {
      throw new Error(
        `Template "${templateName}" has a ${headerFormat} header but no media was provided`
      );
    }

    const key = headerFormat.toLowerCase();
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

  if (variables.length > 0) {
    components.push({
      type: "body",
      parameters: variables.map((v, i) => {
        const param = { type: "text", text: String(v) };
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
