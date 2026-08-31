// Inbox bridge — injects incoming messages into Chatwoot via the Public API.
// The public path authenticates with the inbox identifier only; no access token needed.

const BASE_URL = (process.env.CHATWOOT_BASE_URL || "https://app.chatwoot.com").replace(/\/$/, "");
const INBOX = process.env.CHATWOOT_INBOX_IDENTIFIER;
const TIMEOUT_MS = 30000;

const isConfigured = () => Boolean(INBOX);

const inboxUrl = (path) => `${BASE_URL}/public/api/v1/inboxes/${INBOX}${path}`;

async function call(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(inboxUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Creates a contact and returns the source_id (which we store as inboxContactId)
async function createContact(lead) {
  const data = await call("/contacts", {
    name: lead.name || "Unknown",
    phone_number: lead.phone,
    identifier: lead.id, // Link to our internal lead record
  });

  // source_id is returned at the root or inside contact_inboxes depending on the version
  const sourceId =
    data?.source_id || data?.contact_inboxes?.[0]?.source_id || data?.contact?.source_id;

  if (!sourceId) throw new Error("Chatwoot did not return a source_id");
  return sourceId;
}

async function createConversation(sourceId) {
  const data = await call(`/contacts/${sourceId}/conversations`, {});
  if (!data?.id) throw new Error("Chatwoot did not return a conversation id");
  return String(data.id);
}

async function postMessage(sourceId, conversationId, content, messageType = "incoming") {
  return call(`/contacts/${sourceId}/conversations/${conversationId}/messages`, {
    content,
    message_type: messageType,
  });
}

// Sends a message with an attachment — uses multipart/form-data instead of JSON
async function postAttachment(sourceId, conversationId, file, content = "") {
  const url = inboxUrl(`/contacts/${sourceId}/conversations/${conversationId}/messages`);

  const form = new FormData();
  if (content) form.append("content", content);
  form.append("attachments[]", file.blob, file.fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // No manual Content-Type — fetch sets it with the boundary automatically
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { isConfigured, createContact, createConversation, postMessage, postAttachment };
