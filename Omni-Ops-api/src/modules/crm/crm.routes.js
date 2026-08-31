const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const {
  handleIncomingMessage,
  sendWelcomeIfNeeded,
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
} = require("./crm.service");
const { verifyWhatsAppSignature } = require("../../middleware/whatsapp.middleware");
const { extractMessages } = require("../../integrations/whatsappPayload");
const { syncLeadToGoogleSheet } = require("../../integrations/googleSheets");
const { notifyNewLead } = require("../../integrations/botNotifier");
const { resolveLeadWorkspace } = require("../../utils/workspaceResolver");

// ==========================================
// 0. Webhook verification (Meta handshake)
// ==========================================
router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[WhatsApp] Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ==========================================
// 1. Webhook endpoint (incoming WhatsApp messages)
// ==========================================
router.post("/whatsapp/webhook", verifyWhatsAppSignature, async (req, res) => {
  const processed = [];
  try {
    const workspace = await resolveLeadWorkspace();
    const messages = extractMessages(req.body);
    for (const message of messages) {
      try {
        const result = await handleIncomingMessage(message, workspace.id);
        if (result) processed.push({ ...result, workspaceId: workspace.id });
      } catch (error) {
        // One bad message must not stop the whole batch
        console.error(`[WhatsApp] Message ${message.waMessageId} failed:`, error.message);
      }
    }
  } catch (error) {
    console.error("[WhatsApp] Unexpected webhook error:", error);
  }
  // Always 200 — anything else makes Meta retry and eventually disable the webhook
  res.sendStatus(200);

  // After the response: the slow stuff
  for (const { lead, interaction, mediaId, workspaceId } of processed) {
    // Alert only on the first message so the channel doesn't flood
    if (!lead.welcomeSentAt) {
      notifyNewLead({
        name: lead.name,
        phone: lead.phone,
        message: interaction.content,
        workspaceId,
      });
    }
    sendWelcomeIfNeeded(lead.id).catch((err) =>
      console.error("[WhatsApp] Welcome error:", err.message)
    );
    pushToInbox(lead.id, interaction.content, "incoming", mediaId).catch((err) =>
      console.error("[Inbox] Push error:", err.message)
    );
    syncLeadToGoogleSheet(lead).catch((err) => console.error("[Sheets] Sync failed:", err.message));
  }
});

// Dev-only test route
if (process.env.NODE_ENV !== "production") {
  router.post("/whatsapp/test", async (req, res) => {
    try {
      const workspace = await resolveLeadWorkspace();
      const messages = extractMessages(req.body);
      const results = [];
      for (const m of messages) {
        const r = await handleIncomingMessage(m, workspace.id);
        if (r) results.push(r);
      }
      return res.status(200).json({ received: messages.length, stored: results.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
}

// ==========================================
// 2. Leads (workspace-scoped)
// ==========================================
router.get("/leads", async (req, res) => {
  try {
    res.status(200).json(await getAllLeads(req.workspace.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/leads/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    res.status(200).json(await updateLeadStatus(req.workspace.id, req.params.id, status));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leads/stats", async (req, res) => {
  try {
    res.status(200).json(await getLeadStats(req.workspace.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/leads/:id/note", async (req, res) => {
  try {
    res.status(200).json(await addLeadNote(req.workspace.id, req.params.id, req.body.note));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leads/filter", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    res.status(200).json(await getLeadsByDateRange(req.workspace.id, startDate, endDate));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/leads/:id", async (req, res) => {
  try {
    res.status(200).json(await deleteLead(req.workspace.id, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/leads/:id/assign", async (req, res) => {
  try {
    res.status(200).json(await assignLead(req.workspace.id, req.params.id, req.body.employeeId));
  } catch (error) {
    console.error("[CRM] Assign failed:", error);
    res.status(500).json({ error: String(error.message || error) });
  }
});

router.patch("/leads/:id/edit", async (req, res) => {
  try {
    const { name, phone, source } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (source) updateData.source = source;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No data provided for update" });
    }
    res.status(200).json(await editLead(req.workspace.id, req.params.id, updateData));
  } catch (error) {
    console.error("[CRM] Edit failed:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/leads", async (req, res) => {
  try {
    const lead = await createLeadManual(req.workspace.id, req.body);
    notifyNewLead({
      name: lead.name,
      phone: lead.phone,
      message: `Added manually${req.body.addedByName ? ` by ${req.body.addedByName}` : ""}`,
      workspaceId: req.workspace.id,
    });
    res.status(201).json(lead);
  } catch (error) {
    if (error.code === "DUPLICATE") {
      return res.status(409).json({ error: error.message, lead: error.lead });
    }
    if (error.code === "INVALID_PHONE") {
      return res.status(400).json({ error: error.message });
    }
    console.error("[CRM] Manual lead creation failed:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/leads/sync", async (req, res) => {
  try {
    res.status(200).json(await syncSheetFromDatabase(req.workspace.id));
  } catch (error) {
    console.error("[Sheets] Rebuild failed:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/leads/bulk", async (req, res) => {
  try {
    res.status(201).json(await createLeadsBulk(req.workspace.id, req.body));
  } catch (error) {
    if (["EMPTY_INPUT", "TOO_MANY"].includes(error.code)) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[CRM] Bulk lead creation failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. Inbox callback (Chatwoot agent replies)
// ==========================================
router.post("/inbox/callback", async (req, res) => {
  // Reply immediately — Chatwoot retries if we're slow
  res.sendStatus(200);
  try {
    const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
    if (secret) {
      const received = (req.get("x-chatwoot-signature") || "").replace(/^sha256=/, "");
      const ts = req.get("x-chatwoot-timestamp") || "";
      if (!received || !ts) {
        console.warn("[Inbox] Callback rejected: missing signature or timestamp");
        return;
      }
      // 5-minute window — prevents replayed requests
      const age = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(age) || age > 300) {
        console.warn("[Inbox] Callback rejected: timestamp out of range");
        return;
      }
      // Chatwoot signs "<timestamp>.<raw body>"
      const payload = `${ts}.${(req.rawBody || Buffer.from("")).toString("utf8")}`;
      const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      const a = Buffer.from(received);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn("[Inbox] Callback rejected: signature mismatch");
        return;
      }
    }

    const body = req.body || {};
    if (body.message_type !== "outgoing") return; // agent replies only
    if (body.private) return; // internal note, not for the customer
    if (!body.sender?.id) return;
    // Our own injected messages (welcome, opt-out confirm) come back as outgoing
    // but with sender type != "user" — ignore them to avoid loops.
    if (body.sender?.type && body.sender.type !== "user") return;

    const conversationId = body.conversation?.id || body.conversation_id;
    const content = body.content || "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!conversationId || (!content && attachments.length === 0)) return;

    await handleAgentReply(conversationId, content, attachments);
  } catch (error) {
    console.error("[Inbox] Callback error:", error.message);
  }
});

module.exports = router;
