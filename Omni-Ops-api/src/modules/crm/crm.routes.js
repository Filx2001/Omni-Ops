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
const { extractMessages } = require("../../utils/whatsappPayload");
const { syncLeadToGoogleSheet } = require("../../utils/googleSheets");
const { notifyNewLead } = require("../../utils/botNotifier");
// ==========================================
// 0. Webhook Verification (عشان ميتا تتأكد إن ده السيرفر بتاعك)
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
// 1. Webhook Endpoint (استقبال رسايل الواتساب)
// ==========================================
router.post("/whatsapp/webhook", verifyWhatsAppSignature, async (req, res) => {
  const processed = [];

  try {
    const messages = extractMessages(req.body);

    for (const message of messages) {
      try {
        const result = await handleIncomingMessage(message);
        if (result) processed.push(result);
      } catch (error) {
        // رسالة واحدة بايظة متوقفش الدفعة كلها
        console.error(`[WhatsApp] Message ${message.waMessageId} failed:`, error.message);
      }
    }
  } catch (error) {
    console.error("[WhatsApp] Unexpected webhook error:", error);
  }

  // دايماً 200 — أي رد تاني بيخلي ميتا تعيد الإرسال وفي الآخر توقف الويب هوك
  res.sendStatus(200);

  // بعد الرد: الحاجات البطيئة
  for (const { lead, interaction, mediaId } of processed) {
    // التنبيه لأول رسالة بس، عشان الروم متتملاش مع كل رد
    if (!lead.welcomeSentAt) {
      notifyNewLead({ name: lead.name, phone: lead.phone, message: interaction.content });
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

// ==========================================
// 1b. مسار تجريبي — التطوير بس، مش موجود في الإنتاج
// ==========================================
if (process.env.NODE_ENV !== "production") {
  router.post("/whatsapp/test", async (req, res) => {
    try {
      const messages = extractMessages(req.body);
      const results = [];
      for (const m of messages) {
        const r = await handleIncomingMessage(m);
        if (r) results.push(r);
      }
      return res.status(200).json({ received: messages.length, stored: results.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
}

// ==========================================
// 2. Fetch Leads Endpoint (عشان نعرض العملاء في الديسكورد أو الداشبورد)
// ==========================================
router.get("/leads", async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.status(200).json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة العميل
router.patch("/leads/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const updatedLead = await updateLeadStatus(req.params.id, status);
    res.status(200).json(updatedLead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leads/stats", async (req, res) => {
  try {
    const stats = await getLeadStats();
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/leads/:id/note", async (req, res) => {
  try {
    const { note } = req.body;
    const updatedLead = await addLeadNote(req.params.id, note);
    res.status(200).json(updatedLead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leads/filter", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const leads = await getLeadsByDateRange(startDate, endDate);
    res.status(200).json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/leads/:id", async (req, res) => {
  try {
    const deletedLead = await deleteLead(req.params.id);
    res.status(200).json(deletedLead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// تعيين موظف لعميل
router.patch("/leads/:id/assign", async (req, res) => {
  try {
    const { employeeId } = req.body;
    const updatedLead = await assignLead(req.params.id, employeeId);
    res.status(200).json(updatedLead);
  } catch (error) {
    console.error("[CRM] Assign failed:", error);
    res.status(500).json({ error: String(error.message || error) });
  }
});

// تعديل بيانات العميل
router.patch("/leads/:id/edit", async (req, res) => {
  try {
    const { name, phone, source } = req.body;

    // بنمرر البيانات اللي اتبعتت بس
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (source) updateData.source = source;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No data provided for update" });
    }

    const updatedLead = await editLead(req.params.id, updateData);
    res.status(200).json(updatedLead);
  } catch (error) {
    console.error("[CRM] Edit failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// إضافة عميل يدوياً
router.post("/leads", async (req, res) => {
  try {
    const lead = await createLeadManual(req.body);
    notifyNewLead({
      name: lead.name,
      phone: lead.phone,
      message: `Added manually${req.body.addedByName ? ` by ${req.body.addedByName}` : ""}`,
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

// إعادة بناء الشيت من الداتابيز
router.post("/leads/sync", async (req, res) => {
  try {
    const result = await syncSheetFromDatabase();
    res.status(200).json(result);
  } catch (error) {
    console.error("[Sheets] Rebuild failed:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/leads/bulk", async (req, res) => {
  try {
    const result = await createLeadsBulk(req.body);
    res.status(201).json(result);
  } catch (error) {
    if (["EMPTY_INPUT", "TOO_MANY"].includes(error.code)) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[CRM] Bulk lead creation failed:", error);
    res.status(500).json({ error: error.message });
  }
});
// ==========================================
// استقبال ردود الموظفين من الـ inbox
// ==========================================
router.post("/inbox/callback", async (req, res) => {
  // بنرد فوراً — Chatwoot بيعيد المحاولة لو تأخرنا
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

      // نافذة 5 دقايق — بتمنع إعادة إرسال طلب قديم مسروق
      const age = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(age) || age > 300) {
        console.warn("[Inbox] Callback rejected: timestamp out of range");
        return;
      }

      // Chatwoot بيوقّع على "<timestamp>.<raw body>" مش على الـ body لوحده
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

    // بيهمنا رسايل الموظفين الخارجة بس
    if (body.message_type !== "outgoing") return;
    if (body.private) return; // ملاحظة داخلية، مش للعميل
    if (!body.sender?.id) return;

    // الرسايل اللي بنحقنها إحنا (ترحيب، تأكيد إيقاف) بتترد علينا كـ outgoing.
    // الموظف الحقيقي نوعه "user" — أي حاجة تانية بنتجاهلها عشان منعملش لوب.
    if (body.sender?.type && body.sender.type !== "user") return;

    const conversationId = body.conversation?.id || body.conversation_id;
    const content = body.content || "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    // مرفق من غير نص لازم يعدي
    if (!conversationId || (!content && attachments.length === 0)) return;

    await handleAgentReply(conversationId, content, attachments);
  } catch (error) {
    console.error("[Inbox] Callback error:", error.message);
  }
});

module.exports = router;
