const prisma = require("../../prisma");
const {
  syncLeadToGoogleSheet,
  deleteLeadFromSheet,
  rebuildLeadsSheet,
} = require("../../integrations/googleSheets");
const { normalizePhone } = require("../../utils/phone");
const { sendText, uploadMedia, sendMedia, SIZE_LIMITS } = require("../../integrations/whatsapp");
const { downloadMedia, downloadUrl } = require("../../integrations/whatsappMedia");
const { compressIfNeeded } = require("../../utils/imageCompress");
const { isOptOut, isOptIn } = require("../../utils/optOut");
const chatwoot = require("../../integrations/chatwoot");

// Configurable via env without redeploying
const WELCOME_TEXT =
  process.env.WHATSAPP_WELCOME_TEXT ||
  "Welcome! 👋\nThank you for contacting us. A member of our team will get back to you shortly.";

const FILE_FAILED_TEXT = "Sorry, we couldn't send that file. We'll try another way.";

// ==========================================
// Core CRM: handle incoming messages
// ==========================================

async function handleIncomingMessage(msg, workspaceId) {
  let event;
  try {
    // Store the full msg + resolved workspace so retries route correctly
    event = await prisma.whatsAppEvent.create({
      data: { waMessageId: msg.waMessageId, payload: { ...msg, workspaceId } },
    });
  } catch (error) {
    if (error.code === "P2002") {
      console.log(`[WhatsApp] Duplicate message ignored: ${msg.waMessageId}`);
      return null;
    }
    throw error;
  }
  return processStoredEvent(event, { ...msg, workspaceId });
}

async function processStoredEvent(event, msg = null) {
  const data = msg || event.payload;
  const { waMessageId, from, name, content, mediaType, mediaId, workspaceId } = data;
  const sentAt = new Date(data.sentAt);
  if (!workspaceId) throw new Error("No workspace resolved for this message");

  try {
    const phone = normalizePhone(from);
    if (!phone) throw new Error(`Could not normalize phone number: ${from}`);

    const optOut = isOptOut(content);
    const optIn = isOptIn(content);

    const lead = await prisma.lead.upsert({
      where: { workspaceId_phone: { workspaceId, phone } },
      create: {
        workspaceId,
        name: name || "Unknown Lead",
        phone,
        source: "WHATSAPP",
        status: "NEW",
        lastInboundAt: sentAt,
        optedOutAt: optOut ? new Date() : null,
      },
      // Name is intentionally NOT updated — the team may have edited it manually
      update: {
        lastInboundAt: sentAt,
        ...(optOut ? { optedOutAt: new Date() } : {}),
        ...(optIn ? { optedOutAt: null } : {}),
      },
      include: { assignedTo: true },
    });

    const interaction = await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: "MESSAGE",
        origin: "CUSTOMER",
        content,
        mediaType,
        waMessageId,
        createdAt: sentAt,
      },
    });

    await prisma.whatsAppEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });

    if (optOut) {
      console.log(`[WhatsApp] ${phone} opted out`);
      confirmOptOut(lead).catch(() => {});
    }
    console.log(`[WhatsApp] Message stored for ${phone} (lead ${lead.id})`);
    return { lead, interaction, mediaId: mediaId || null };
  } catch (error) {
    await prisma.whatsAppEvent
      .update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          error: String(error.message || error).slice(0, 1000),
        },
      })
      .catch(() => {});
    console.error(`[WhatsApp] Failed to process ${waMessageId}:`, error.message);
    throw error;
  }
}

// Confirms opt-out. Important for Meta rating — ignoring a stop request
// pushes users toward "block & report", which harms the whole number.
async function confirmOptOut(lead) {
  const text = "You've been unsubscribed from promotional messages. You can message us anytime.";
  const waMessageId = await sendText(lead.phone, text);
  await prisma.interaction.create({
    data: {
      leadId: lead.id,
      type: "SYSTEM_NOTE",
      origin: "AUTOMATION",
      content: text,
      waMessageId,
    },
  });
  pushToInbox(lead.id, `🤖 [Auto-reply sent]\n${text}`, "outgoing").catch(() => {});
}

// Sends the welcome message exactly once per lead.
// Called after replying to Meta so it never delays the webhook response.
async function sendWelcomeIfNeeded(leadId) {
  const claimed = await prisma.lead.updateMany({
    where: { id: leadId, welcomeSentAt: null },
    data: { welcomeSentAt: new Date() },
  });
  if (claimed.count === 0) return false; // already sent

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead?.phone) return false;

  try {
    const waMessageId = await sendText(lead.phone, WELCOME_TEXT);
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: "MESSAGE",
        origin: "AUTOMATION",
        content: WELCOME_TEXT,
        waMessageId,
      },
    });
    console.log(`[WhatsApp] Welcome sent to ${lead.phone}`);
    pushToInbox(lead.id, `🤖 [Auto-reply sent]\n${WELCOME_TEXT}`, "outgoing").catch(() => {});
    return true;
  } catch (error) {
    // Release the claim so the next message retries
    await prisma.lead
      .update({ where: { id: leadId }, data: { welcomeSentAt: null } })
      .catch(() => {});
    console.error(`[WhatsApp] Welcome failed for ${lead.phone}:`, error.message);
    return false;
  }
}

// ==========================================
// Inbox bridges (Chatwoot)
// ==========================================

const FILE_TYPE_MAP = { image: "image", video: "video", audio: "audio", file: "document" };

async function pushToInbox(leadId, content, messageType = "incoming", mediaId = null) {
  if (!chatwoot.isConfigured() || !content) return;
  try {
    let lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    if (!lead.inboxContactId) {
      const sourceId = await chatwoot.createContact(lead);
      lead = await prisma.lead.update({
        where: { id: leadId },
        data: { inboxContactId: sourceId },
      });
    }
    if (!lead.inboxConversationId) {
      const conversationId = await chatwoot.createConversation(lead.inboxContactId);
      lead = await prisma.lead.update({
        where: { id: leadId },
        data: { inboxConversationId: conversationId },
      });
    }

    const file = mediaId ? await downloadMedia(mediaId) : null;
    if (file) {
      await chatwoot.postAttachment(
        lead.inboxContactId,
        lead.inboxConversationId,
        file,
        content.startsWith("[") ? "" : content
      );
      console.log(`[Inbox] Pushed media for ${lead.phone}`);
    } else {
      await chatwoot.postMessage(
        lead.inboxContactId,
        lead.inboxConversationId,
        content,
        messageType
      );
      console.log(`[Inbox] Pushed message for ${lead.phone}`);
    }
  } catch (error) {
    console.error("[Inbox] Push failed:", error.message);
  }
}

async function handleAgentReply(conversationId, content, attachments = []) {
  const lead = await prisma.lead.findFirst({
    where: { inboxConversationId: String(conversationId) },
  });
  if (!lead?.phone) {
    console.warn(`[Inbox] No lead found for conversation ${conversationId}`);
    return false;
  }

  let remainingText = content || "";
  for (const att of attachments) {
    const waType = FILE_TYPE_MAP[att.file_type];
    if (!waType) {
      console.warn(`[Inbox] Unsupported attachment type: ${att.file_type}`);
      continue;
    }
    try {
      const fileName = att.data_url?.split("/").pop()?.split("?")[0] || `file-${Date.now()}`;
      const downloadLimit = waType === "image" ? 25 * 1024 * 1024 : SIZE_LIMITS[waType];
      let file = await downloadUrl(att.data_url, downloadLimit, fileName);
      if (file && waType === "image") {
        file = await compressIfNeeded(file);
        if (file.blob.size > SIZE_LIMITS.image) file = null;
      }
      if (!file) {
        await sendText(lead.phone, FILE_FAILED_TEXT);
        continue;
      }
      const mediaId = await uploadMedia(file.blob, file.fileName, file.mimeType);
      const waMessageId = await sendMedia(
        lead.phone,
        mediaId,
        waType,
        remainingText,
        file.fileName
      );
      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: "MESSAGE",
          origin: "AGENT",
          content: remainingText || `[${waType}]`,
          mediaType: waType,
          waMessageId,
        },
      });
      remainingText = "";
      console.log(`[Inbox] Agent ${waType} sent to ${lead.phone}`);
    } catch (error) {
      console.error("[Inbox] Attachment failed:", error.message);
      await sendText(lead.phone, FILE_FAILED_TEXT).catch(() => {});
    }
  }

  if (remainingText) {
    const waMessageId = await sendText(lead.phone, remainingText);
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: "MESSAGE",
        origin: "AGENT",
        content: remainingText,
        waMessageId,
      },
    });
    console.log(`[Inbox] Agent reply sent to ${lead.phone}`);
  }
  return true;
}

// ==========================================
// Workspace-scoped CRUD
// ==========================================

async function getAllLeads(workspaceId) {
  return prisma.lead.findMany({
    where: { workspaceId },
    include: {
      assignedTo: true,
      interactions: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { updatedAt: "desc" },
  });
}

const assignLead = async (workspaceId, leadId, employeeId) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId, workspaceId },
    data: { assignedTo: { connect: { id: employeeId } } },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed on assign:", err.message)
  );
  return updatedLead;
};

const updateLeadStatus = async (workspaceId, leadId, newStatus) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId, workspaceId },
    data: { status: newStatus },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );
  return updatedLead;
};

const getLeadStats = async (workspaceId) => {
  const allLeads = await prisma.lead.findMany({ where: { workspaceId } });
  return {
    total: allLeads.length,
    byStatus: {
      NEW: allLeads.filter((l) => l.status === "NEW").length,
      CONTACTED: allLeads.filter((l) => l.status === "CONTACTED").length,
      QUALIFIED: allLeads.filter((l) => l.status === "QUALIFIED").length,
      CONVERTED: allLeads.filter((l) => l.status === "CONVERTED").length,
      LOST: allLeads.filter((l) => l.status === "LOST").length,
    },
  };
};

const addLeadNote = async (workspaceId, leadId, noteContent) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId, workspaceId },
    data: { notes: noteContent },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );
  return updatedLead;
};

const getLeadsByDateRange = async (workspaceId, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  return prisma.lead.findMany({
    where: { workspaceId, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: "desc" },
    include: { assignedTo: true },
  });
};

const deleteLead = async (workspaceId, leadId) => {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new Error("Lead not found");
  const deletedLead = await prisma.lead.delete({ where: { id: leadId } });
  deleteLeadFromSheet(deletedLead).catch((err) =>
    console.error("[Sheets] Delete failed:", err.message)
  );
  return deletedLead;
};

const editLead = async (workspaceId, leadId, updateData) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId, workspaceId },
    data: {
      name: updateData.name !== undefined ? updateData.name : undefined,
      phone: updateData.phone !== undefined ? updateData.phone : undefined,
      source: updateData.source !== undefined ? updateData.source : undefined,
    },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );
  return updatedLead;
};

const syncSheetFromDatabase = async (workspaceId) => {
  const leads = await prisma.lead.findMany({
    where: { workspaceId },
    include: { assignedTo: true },
    orderBy: { createdAt: "asc" },
  });
  const stats = await rebuildLeadsSheet(leads);
  return { total: leads.length, ...stats };
};

// Manual lead add — rejects duplicates so the team sees the existing record
// instead of creating a second one. lastInboundAt stays null: this contact
// never messaged us, so free-form messages are not allowed (templates only).
const createLeadManual = async (workspaceId, { name, phone, source, notes, addedByName }) => {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    const error = new Error("Invalid phone number");
    error.code = "INVALID_PHONE";
    throw error;
  }
  const existing = await prisma.lead.findUnique({
    where: { workspaceId_phone: { workspaceId, phone: normalized } },
    include: { assignedTo: true },
  });
  if (existing) {
    const error = new Error("A lead with this phone number already exists");
    error.code = "DUPLICATE";
    error.lead = existing;
    throw error;
  }

  const finalName = name?.trim() || `Customer ${normalized.slice(-4)}`;
  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      name: finalName,
      phone: normalized,
      source: source || "MANUAL",
      status: "NEW",
      notes: notes || null,
      optInSource: `Added manually${addedByName ? ` by ${addedByName}` : ""} - ${source || "MANUAL"}`,
    },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(lead).catch((err) => console.error("[Sheets] Sync failed:", err.message));
  console.log(`[CRM] Lead added manually: ${normalized}`);
  return lead;
};

const MAX_BULK = 400;

const createLeadsBulk = async (workspaceId, { input, source, notes, addedByName }) => {
  const rawParts = String(input || "")
    .split(/[\n,;\t]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (rawParts.length === 0) {
    const error = new Error("No phone numbers were provided");
    error.code = "EMPTY_INPUT";
    throw error;
  }
  if (rawParts.length > MAX_BULK) {
    const error = new Error(
      `Too many numbers at once (${rawParts.length}). The limit is ${MAX_BULK} per batch.`
    );
    error.code = "TOO_MANY";
    throw error;
  }

  const added = [];
  const duplicates = [];
  const invalid = [];
  const seen = new Set();

  for (const raw of rawParts) {
    const normalized = normalizePhone(raw);
    if (!normalized) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push({ phone: normalized, reason: "repeated in this batch" });
      continue;
    }
    seen.add(normalized);
    try {
      const lead = await prisma.lead.create({
        data: {
          workspaceId,
          name: `Customer ${normalized.slice(-4)}`,
          phone: normalized,
          source: source || "MANUAL",
          status: "NEW",
          notes: notes || null,
          optInSource: `Bulk import${addedByName ? ` by ${addedByName}` : ""} - ${source || "MANUAL"}`,
        },
      });
      added.push(lead);
    } catch (error) {
      if (error.code === "P2002") {
        duplicates.push({ phone: normalized, reason: "already in the CRM" });
        continue;
      }
      throw error;
    }
  }

  // One batched sheet rebuild instead of N sequential calls (Google rate limits)
  if (added.length > 0) {
    const allLeads = await prisma.lead.findMany({
      where: { workspaceId },
      include: { assignedTo: true },
      orderBy: { createdAt: "asc" },
    });
    rebuildLeadsSheet(allLeads).catch((err) =>
      console.error("[Sheets] Bulk rebuild failed:", err.message)
    );
  }

  console.log(
    `[CRM] Bulk add: ${added.length} added, ${duplicates.length} duplicate, ${invalid.length} invalid`
  );
  return {
    submitted: rawParts.length,
    addedCount: added.length,
    duplicateCount: duplicates.length,
    invalidCount: invalid.length,
    added: added.map((l) => ({ id: l.id, name: l.name, phone: l.phone })),
    duplicates,
    invalid,
  };
};

module.exports = {
  handleIncomingMessage,
  sendWelcomeIfNeeded,
  processStoredEvent,
  getAllLeads,
  assignLead,
  updateLeadStatus,
  getLeadStats,
  addLeadNote,
  getLeadsByDateRange,
  deleteLead,
  editLead,
  syncSheetFromDatabase,
  pushToInbox,
  handleAgentReply,
  createLeadManual,
  createLeadsBulk,
};
