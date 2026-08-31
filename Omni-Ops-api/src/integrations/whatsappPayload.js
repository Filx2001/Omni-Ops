// Unpacks Meta's complex webhook payload into a unified message format.
// Nothing here touches the database, and no function here ever throws an exception —
// missing fields result in the message being ignored rather than crashing the server.

function extractContent(message) {
  const type = message?.type;

  switch (type) {
    case "text":
      return { content: message.text?.body || "[Empty message]", mediaType: null };

    case "image":
      return {
        content: message.image?.caption || "[Image]",
        mediaType: "image",
        mediaId: message.image?.id,
      };

    case "video":
      return {
        content: message.video?.caption || "[Video]",
        mediaType: "video",
        mediaId: message.video?.id,
      };

    case "audio":
      // voice=true means voice note, false means uploaded audio file
      return {
        content: message.audio?.voice ? "[Voice note]" : "[Audio]",
        mediaType: "audio",
        mediaId: message.audio?.id,
      };

    case "document": {
      const name = message.document?.filename;
      return {
        content: name ? `[File] ${name}` : "[File]",
        mediaType: "document",
        mediaId: message.document?.id,
      };
    }

    case "sticker":
      return { content: "[Sticker]", mediaType: "sticker", mediaId: message.sticker?.id };

    case "location": {
      const loc = message.location || {};
      const label = loc.name || loc.address;
      return {
        content: label ? `[Location] ${label}` : `[Location] ${loc.latitude}, ${loc.longitude}`,
        mediaType: "location",
      };
    }

    case "contacts":
      return { content: "[Contact]", mediaType: "contacts" };

    case "reaction":
      return { content: `[Reaction] ${message.reaction?.emoji || ""}`.trim(), mediaType: null };

    case "button":
      return { content: message.button?.text || "[Button click]", mediaType: null };

    case "interactive": {
      const i = message.interactive || {};
      const title = i.button_reply?.title || i.list_reply?.title;
      return { content: title || "[Interactive reply]", mediaType: null };
    }

    case "unsupported":
      return { content: "[Unsupported message type]", mediaType: null };

    default:
      return { content: `[${type || "Unknown"}]`, mediaType: null };
  }
}

// Meta sends time in seconds, JS wants milliseconds
function parseTimestamp(ts) {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  const date = new Date(seconds * 1000);
  return isNaN(date.getTime()) ? new Date() : date;
}

// Loops through all entries and changes (Meta sends batches, not single items)
// and returns an array of ready-to-process messages. Status updates are silently ignored.
function extractMessages(body) {
  const out = [];

  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (messages.length === 0) continue; // Delivery/read receipts

      // Map wa_id to profile name
      const names = {};
      for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
        if (c?.wa_id) names[c.wa_id] = c.profile?.name;
      }

      for (const message of messages) {
        const waMessageId = message?.id;
        const from = message?.from;

        if (!waMessageId || !from) {
          console.warn("[WhatsApp] Skipped a message with no id or sender");
          continue;
        }

        const { content, mediaType, mediaId } = extractContent(message);

        out.push({
          waMessageId,
          from,
          name: names[from] || null,
          content,
          mediaType,
          mediaId: mediaId || null,
          sentAt: parseTimestamp(message.timestamp),
          raw: message,
        });
      }
    }
  }

  return out;
}

module.exports = { extractMessages, extractContent, parseTimestamp };
