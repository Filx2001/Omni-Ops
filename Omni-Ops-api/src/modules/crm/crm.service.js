const prisma = require("../../prisma");
const {
  syncLeadToGoogleSheet,
  deleteLeadFromSheet,
  rebuildLeadsSheet,
} = require("../../utils/googleSheets");
const { normalizePhone } = require("../../utils/phone");
const { sendText, uploadMedia, sendMedia, SIZE_LIMITS } = require("../../utils/whatsapp");
const { downloadMedia, downloadUrl } = require("../../utils/whatsappMedia");
const { compressIfNeeded } = require("../../utils/imageCompress");
const { isOptOut, isOptIn } = require("../../utils/optOut");
const chatwoot = require("../../utils/chatwoot");

// النص قابل للتغيير من متغير بيئة من غير deploy
// \u200F (RLM) بيمنع الخلط في اتجاه النص لما العربي والإنجليزي يتلاقوا
const WELCOME_TEXT =
  process.env.WHATSAPP_WELCOME_TEXT ||
  [
    "\u200Fأهلاً بك في *Logiscool Qatar* 👋",
    "\u200Fشكرًا لتواصلكم مع لوجيسكول! سيتواصل معكم أحد ممثلينا في أقرب وقت ممكن.",
    "",
    "Welcome to *Logiscool Qatar* 👋",
    "Thank you for contacting Logiscool! Our representative shall attend to you shortly.",
  ].join("\n");

// رسالة بتتبعت للعميل لو الملف فشل — إنجليزي وعربي لأنها للعميل
const FILE_FAILED_TEXT =
  "\u200Fعذراً، تعذّر إرسال الملف. سنحاول إرساله بطريقة أخرى.\n\n" +
  "Sorry, we couldn't send that file. We'll try another way.";

// ==========================================
// Core CRM Logic: Handle Incoming Messages
// ==========================================
/**
 * بيسجّل الحدث الخام الأول (ده مفتاح منع التكرار)، وبعدين يعالجه.
 * بيرجع { lead, interaction, mediaId } أو null لو مكررة.
 */
async function handleIncomingMessage(msg) {
  let event;
  try {
    // بنخزّن msg كامل — جواه الحقول المفكوكة والرسالة الخام مع بعض،
    // وده اللي بيخلي إعادة المعالجة ممكنة لو فشلت أول مرة
    event = await prisma.whatsAppEvent.create({
      data: { waMessageId: msg.waMessageId, payload: msg },
    });
  } catch (error) {
    if (error.code === "P2002") {
      console.log(`[WhatsApp] Duplicate message ignored: ${msg.waMessageId}`);
      return null;
    }
    throw error;
  }

  return processStoredEvent(event, msg);
}

/**
 * منطق المعالجة الفعلي — منفصل عشان مسح الاسترجاع يقدر يندهه
 * على أحداث محفوظة فشلت قبل كده.
 */
async function processStoredEvent(event, msg = null) {
  const data = msg || event.payload;
  const { waMessageId, from, name, content, mediaType, mediaId } = data;
  const sentAt = new Date(data.sentAt); // بيرجع نص من الـ JSON

  try {
    const phone = normalizePhone(from);
    if (!phone) throw new Error(`Could not normalize phone number: ${from}`);

    // الاشتراك/الإلغاء بيتحدد من نص الرسالة
    const optOut = isOptOut(content);
    const optIn = isOptIn(content);

    const lead = await prisma.lead.upsert({
      where: { phone },
      create: {
        name: name || "Unknown Lead",
        phone,
        source: "WHATSAPP",
        status: "NEW",
        lastInboundAt: sentAt,
        optedOutAt: optOut ? new Date() : null,
      },
      // الاسم مش بيتحدث عمداً — ممكن الفريق يكون عدله يدوي
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

/**
 * تأكيد الإيقاف. مهم للتقييم عند ميتا — لو العميل حس إن طلبه اتجاهل
 * هيضغط "حظر وإبلاغ"، وده بيضر الرقم كله.
 * مجاني لأن نافذة الـ 24 ساعة مفتوحة (هو لسه باعت).
 */
async function confirmOptOut(lead) {
  const text =
    "\u200Fتم إيقاف الرسائل الترويجية. لن تصلك رسائل تسويقية بعد الآن.\n" +
    "\u200Fيمكنك مراسلتنا في أي وقت وسنرد عليك.\n\n" +
    "You've been unsubscribed from promotional messages. You can message us anytime.";

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

/**
 * بيبعت رسالة الترحيب مرة واحدة بس لكل عميل.
 * بيتنده بعد ما نرد على ميتا، عشان ميأخرش الرد.
 */
async function sendWelcomeIfNeeded(leadId) {
  // بنحجز الترحيب بتحديث مشروط — لو رسالتين جم مع بعض، واحدة بس هتعدي
  const claimed = await prisma.lead.updateMany({
    where: { id: leadId, welcomeSentAt: null },
    data: { welcomeSentAt: new Date() },
  });
  if (claimed.count === 0) return false; // اتبعت قبل كده

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
    // بنحقنه في الـ inbox كرسالة مننا عشان الموظف يشوف إن العميل اترد عليه
    pushToInbox(lead.id, `🤖 [Auto-reply sent]\n${WELCOME_TEXT}`, "outgoing").catch(() => {});
    return true;
  } catch (error) {
    // بنرجّع الحجز عشان الرسالة الجاية تحاول تاني
    await prisma.lead
      .update({ where: { id: leadId }, data: { welcomeSentAt: null } })
      .catch(() => {});
    console.error(`[WhatsApp] Welcome failed for ${lead.phone}:`, error.message);
    return false;
  }
}

// ==========================================
// Inbox Bridges
// ==========================================

// Chatwoot بيسمي الأنواع بشكل مختلف عن ميتا
const FILE_TYPE_MAP = { image: "image", video: "video", audio: "audio", file: "document" };

/**
 * بيبعت رسالة العميل للـ inbox عشان الفريق يشوفها ويرد.
 * بيتنده بعد الرد على ميتا. بيفشل بهدوء — الداتابيز هي مصدر الحقيقة.
 */
async function pushToInbox(leadId, content, messageType = "incoming", mediaId = null) {
  if (!chatwoot.isConfigured() || !content) return;

  try {
    let lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    // أول مرة: ننشئ الـ contact والمحادثة ونخزّن معرفاتهم
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

    // لو فيه ميديا، بننقلها لـ Chatwoot. لو التنزيل فشل، بنبعت النص البديل
    const file = mediaId ? await downloadMedia(mediaId) : null;

    if (file) {
      await chatwoot.postAttachment(
        lead.inboxContactId,
        lead.inboxConversationId,
        file,
        // الأقواس المربعة معناها نص بديل مش كابشن حقيقي
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

/**
 * الموظف رد من الـ inbox → نبعت لواتساب ونسجّل.
 * بيدعم النص والمرفقات. الملفات بتتنقل من غير تخزين على السيرفر.
 */
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
      // بننزّل بحد أوسع للصور عشان نضغطها بعدين — الفيديو مفيش ضغط
      const downloadLimit = waType === "image" ? 25 * 1024 * 1024 : SIZE_LIMITS[waType];
      let file = await downloadUrl(att.data_url, downloadLimit, fileName);

      if (file && waType === "image") {
        file = await compressIfNeeded(file);
        // لسه كبيرة بعد الضغط؟ ميتا هترفضها
        if (file.blob.size > SIZE_LIMITS.image) file = null;
      }

      if (!file) {
        await sendText(lead.phone, FILE_FAILED_TEXT);
        continue;
      }

      const mediaId = await uploadMedia(file.blob, file.fileName, file.mimeType);
      // الكابشن مع أول مرفق بس، عشان النص ميتكررش
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

      remainingText = ""; // اتبعت مع المرفق خلاص
      console.log(`[Inbox] Agent ${waType} sent to ${lead.phone}`);
    } catch (error) {
      console.error("[Inbox] Attachment failed:", error.message);
      await sendText(lead.phone, FILE_FAILED_TEXT).catch(() => {});
    }
  }

  // نص لوحده، أو نص مبعتش مع أي مرفق
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
// Fetch Leads for the Discord Bot / Dashboard
// ==========================================
async function getAllLeads() {
  return prisma.lead.findMany({
    include: {
      assignedTo: true,
      interactions: {
        orderBy: { createdAt: "desc" },
        take: 10, // نجيب آخر رسايل بس عشان نعرضها في الملخص
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// دالة لربط العميل بموظف (بالطريقة الآمنة وتحديث الشيت)
const assignLead = async (leadId, employeeId) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      assignedTo: {
        connect: { id: employeeId },
      },
    },
    include: { assignedTo: true },
  });

  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed on assign:", err.message)
  );

  return updatedLead;
};

const updateLeadStatus = async (leadId, newStatus) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: { status: newStatus },
    include: { assignedTo: true }, // عشان اسم الموظف يفضل موجود في الشيت
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );
  return updatedLead;
};

const getLeadStats = async () => {
  const allLeads = await prisma.lead.findMany();

  const stats = {
    total: allLeads.length,
    byStatus: {
      NEW: allLeads.filter((l) => l.status === "NEW").length,
      CONTACTED: allLeads.filter((l) => l.status === "CONTACTED").length,
      QUALIFIED: allLeads.filter((l) => l.status === "QUALIFIED").length,
      CONVERTED: allLeads.filter((l) => l.status === "CONVERTED").length,
      LOST: allLeads.filter((l) => l.status === "LOST").length,
    },
  };
  return stats;
};

// دالة لإضافة ملاحظة جديدة للعميل
const addLeadNote = async (leadId, noteContent) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: { notes: noteContent },
    include: { assignedTo: true },
  });
  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );
  return updatedLead;
};

const getLeadsByDateRange = async (startDate, endDate) => {
  // بنحول التاريخ لنوع Date عشان Prisma يفهمه
  const start = new Date(startDate);
  const end = new Date(endDate);
  // بنمدد تاريخ النهاية عشان يغطي اليوم كله
  end.setHours(23, 59, 59, 999);

  return await prisma.lead.findMany({
    where: {
      createdAt: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { createdAt: "desc" },
    include: { assignedTo: true },
  });
};

// دالة لحذف العميل بالكامل — الـ interactions بتتمسح بالـ cascade
const deleteLead = async (leadId) => {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead not found");

  const deletedLead = await prisma.lead.delete({
    where: { id: leadId },
  });

  deleteLeadFromSheet(deletedLead).catch((err) =>
    console.error("[Sheets] Delete failed:", err.message)
  );
  return deletedLead;
};

// دالة تعديل بيانات العميل الأساسية (الاسم، الرقم، المصدر)
const editLead = async (leadId, updateData) => {
  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      name: updateData.name !== undefined ? updateData.name : undefined,
      phone: updateData.phone !== undefined ? updateData.phone : undefined,
      source: updateData.source !== undefined ? updateData.source : undefined,
    },
    include: { assignedTo: true }, // عشان الشيت يفضل محتفظ باسم الموظف
  });

  syncLeadToGoogleSheet(updatedLead).catch((err) =>
    console.error("[Sheets] Sync failed:", err.message)
  );

  return updatedLead;
};

// بيعيد بناء الشيت من الداتابيز — للاستخدام لو حد عدّل الشيت بإيده
const syncSheetFromDatabase = async () => {
  const leads = await prisma.lead.findMany({
    include: { assignedTo: true },
    orderBy: { createdAt: "asc" },
  });
  const stats = await rebuildLeadsSheet(leads);
  return { total: leads.length, ...stats };
};
/**
 * إضافة عميل يدوياً — للموظف اللي رد على تليفون أو استقبل حد في المقر.
 * بيرفض لو الرقم موجود عشان الموظف يشوف السجل القديم بدل ما يكرره.
 * ملحوظة: lastInboundAt بتفضل null — العميل ده مبعتش لنا، فمينفعش نبعتله
 * رسالة حرة، وبيتستبعد من الحملات لحد ما يرد.
 */
const createLeadManual = async ({ name, phone, source, notes, addedByName }) => {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    const error = new Error("Invalid phone number");
    error.code = "INVALID_PHONE";
    throw error;
  }

  const existing = await prisma.lead.findUnique({
    where: { phone: normalized },
    include: { assignedTo: true },
  });

  if (existing) {
    const error = new Error("A lead with this phone number already exists");
    error.code = "DUPLICATE";
    error.lead = existing;
    throw error;
  }

  // مفيش اسم؟ بنستخدم آخر 4 أرقام عشان الموظف يعرف مين ده
  const finalName = name?.trim() || `Customer ${normalized.slice(-4)}`;

  const lead = await prisma.lead.create({
    data: {
      name: finalName,
      phone: normalized,
      source: source || "MANUAL",
      status: "NEW",
      notes: notes || null,
      // مصدر الموافقة — حماية لو ميتا سألت عن سبب التواصل
      optInSource: `Added manually${addedByName ? ` by ${addedByName}` : ""} - ${source || "MANUAL"}`,
    },
    include: { assignedTo: true },
  });

  syncLeadToGoogleSheet(lead).catch((err) => console.error("[Sheets] Sync failed:", err.message));

  console.log(`[CRM] Lead added manually: ${normalized}`);
  return lead;
};

const MAX_BULK = 400;

/**
 * إضافة مجموعة أرقام مرة واحدة.
 *
 * المبدأ: رقم واحد بايظ ما يوقفش الدفعة. كل رقم بيتصنّف في واحدة من
 * تلاتة (اتضاف · مكرر · غلط) والتقرير بيرجع كامل عشان الموظف يصلّح
 * الغلط بس ويعيد لصقه.
 *
 * ملحوظة مهمة: زي createLeadManual، الـ lastInboundAt بتفضل null —
 * دول مبعتولناش، فمينفعش نبعتلهم رسايل حرة، والقالب هو الطريق الوحيد.
 */
const createLeadsBulk = async ({ input, source, notes, addedByName }) => {
  // الفاصل: سطر جديد أو فاصلة أو فاصلة منقوطة أو تاب
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

  // المكرر جوه نفس اللصقة — بيتمسك من غير ما نضرب الداتابيز
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
          name: `Customer ${normalized.slice(-4)}`,
          phone: normalized,
          source: source || "MANUAL",
          status: "NEW",
          notes: notes || null,
          // مصدر الموافقة — حماية لو ميتا سألت عن سبب التواصل
          optInSource: `Bulk import${addedByName ? ` by ${addedByName}` : ""} - ${source || "MANUAL"}`,
        },
      });
      added.push(lead);
    } catch (error) {
      // P2002 = القيد الفريد على الرقم اتكسر، يعني موجود قبل كده.
      // بنعتمد على الداتابيز مش على فحص مسبق — أسرع وما فيهوش سباق.
      if (error.code === "P2002") {
        duplicates.push({ phone: normalized, reason: "already in the CRM" });
        continue;
      }
      throw error;
    }
  }

  // مزامنة واحدة في الآخر بدل نداء لكل عميل —
  // 100 نداء ورا بعض بيضربوا حد جوجل وبيفشلوا كلهم.
  if (added.length > 0) {
    const allLeads = await prisma.lead.findMany({
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
