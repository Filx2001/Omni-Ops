const prisma = require("../../prisma");
const {
  sendTemplate,
  getTemplates,
  uploadMedia,
  SIZE_LIMITS,
} = require("../../integrations/whatsapp");
const { downloadUrl } = require("../../integrations/whatsappMedia");

const MIN_COOLDOWN_DAYS = 7;
const DEFAULT_COOLDOWN_DAYS = 14;
const MAX_FILTER_DAYS = 730;
// 1 message / 2s = 30/min — slow on purpose; sudden bursts hurt Meta quality rating
const SEND_INTERVAL_MS = 2000;
const MAX_BATCH = Number(process.env.CAMPAIGN_MAX_BATCH || 400);
// Meta codes for "user exceeded daily marketing limit" — defer, don't fail
const RATE_LIMIT_CODES = ["131049", "131056"];
const MAX_ATTEMPTS = 3;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function loadLeads(workspaceId) {
  return prisma.lead.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      source: true,
      optedOutAt: true,
      lastInboundAt: true,
      lastMarketingAt: true,
      createdAt: true,
    },
  });
}

async function getAudienceStats(workspaceId) {
  const leads = await loadLeads(workspaceId);
  const optedOut = leads.filter((l) => l.optedOutAt).length;
  const noPhone = leads.filter((l) => !l.optedOutAt && !l.phone).length;
  const reachable = leads.filter((l) => !l.optedOutAt && l.phone);

  const activeWithin = (days) => {
    const cutoff = daysAgo(days);
    return reachable.filter((l) => l.lastInboundAt && l.lastInboundAt >= cutoff).length;
  };
  const activeBefore = (days) => {
    const cutoff = daysAgo(days);
    return reachable.filter((l) => l.lastInboundAt && l.lastInboundAt < cutoff).length;
  };
  const addedWithin = (days) => {
    const cutoff = daysAgo(days);
    return reachable.filter((l) => l.createdAt >= cutoff).length;
  };
  const addedBefore = (days) => {
    const cutoff = daysAgo(days);
    return reachable.filter((l) => l.createdAt < cutoff).length;
  };

  const byStatus = {};
  for (const l of reachable) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
  const bySource = {};
  for (const l of reachable)
    bySource[l.source || "UNKNOWN"] = (bySource[l.source || "UNKNOWN"] || 0) + 1;

  return {
    total: leads.length,
    optedOut,
    noPhone,
    reachable: reachable.length,
    added: { d1: addedWithin(1), d7: addedWithin(7), d30: addedWithin(30) },
    inSystem: { m3: addedBefore(90), m6: addedBefore(180), y1: addedBefore(365) },
    activity: {
      d7: activeWithin(7),
      d30: activeWithin(30),
      d60: activeWithin(60),
      never: reachable.filter((l) => !l.lastInboundAt).length,
    },
    dormant: { m3: activeBefore(90), m6: activeBefore(180) },
    byStatus,
    bySource,
    recentlyMarketed: reachable.filter((l) => l.lastMarketingAt && l.lastMarketingAt >= daysAgo(7))
      .length,
  };
}

function parseDaysFilter(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a whole number greater than 0`);
  }
  if (n > MAX_FILTER_DAYS) {
    throw new Error(`${label} cannot be more than ${MAX_FILTER_DAYS} days`);
  }
  return n;
}

function filterEligible(leads, filters) {
  const {
    addedWithinDays = null,
    addedBeforeDays = null,
    activeWithinDays = null,
    activeBeforeDays = null,
    audienceSource = null,
    audienceStatus = null,
    cooldownDays = DEFAULT_COOLDOWN_DAYS,
  } = filters;

  const funnel = [];
  let pool = leads;
  const step = (key, label, kind, predicate) => {
    const kept = pool.filter(predicate);
    funnel.push({
      key,
      label,
      kind, // "block" = non-optional protection · "filter" = user-chosen narrowing
      in: pool.length,
      removed: pool.length - kept.length,
      out: kept.length,
    });
    pool = kept;
  };

  // 1. Unreachable
  step("optedOut", "Opted out", "block", (l) => !l.optedOutAt);
  step("noPhone", "No phone number", "block", (l) => Boolean(l.phone));

  // 2. Narrowing
  if (addedWithinDays) {
    const cutoff = daysAgo(addedWithinDays);
    step(
      "addedWithin",
      `Added in the last ${addedWithinDays} day(s)`,
      "filter",
      (l) => l.createdAt >= cutoff
    );
  }
  if (addedBeforeDays) {
    const cutoff = daysAgo(addedBeforeDays);
    step(
      "addedBefore",
      `In the system for more than ${addedBeforeDays} day(s)`,
      "filter",
      (l) => l.createdAt < cutoff
    );
  }
  if (activeWithinDays) {
    const cutoff = daysAgo(activeWithinDays);
    step(
      "activeWithin",
      `Messaged us in the last ${activeWithinDays} day(s)`,
      "filter",
      (l) => l.lastInboundAt && l.lastInboundAt >= cutoff
    );
  }
  if (activeBeforeDays) {
    const cutoff = daysAgo(activeBeforeDays);
    step(
      "activeBefore",
      `Last message older than ${activeBeforeDays} day(s)`,
      "filter",
      (l) => l.lastInboundAt && l.lastInboundAt < cutoff
    );
  }
  if (audienceSource) {
    step("source", `Source: ${audienceSource}`, "filter", (l) => l.source === audienceSource);
  }
  if (audienceStatus) {
    step("status", `Status: ${audienceStatus}`, "filter", (l) => l.status === audienceStatus);
  }

  // 3. Protection (always last, never optional)
  const cooldownCutoff = daysAgo(cooldownDays);
  step(
    "cooldown",
    `Marketed to in the last ${cooldownDays} day(s)`,
    "block",
    (l) => !l.lastMarketingAt || l.lastMarketingAt < cooldownCutoff
  );

  return { eligible: pool, funnel };
}

function findEmptyingStep(funnel) {
  for (let i = funnel.length - 1; i >= 0; i--) {
    if (funnel[i].out === 0 && funnel[i].in > 0) return funnel[i];
  }
  return null;
}

async function createCampaign(input, workspaceId) {
  const {
    name,
    templateName,
    templateLanguage = "en",
    variables = [],
    audienceStatus = null,
    audienceSource = null,
    cooldownDays = DEFAULT_COOLDOWN_DAYS,
    createdById = null,
    createdByName = null,
    headerMediaUrl = null,
    audienceDays = null,
  } = input;

  if (!name || !templateName) throw new Error("Campaign name and template are required");
  if (cooldownDays < MIN_COOLDOWN_DAYS) {
    throw new Error(`Cooldown must be at least ${MIN_COOLDOWN_DAYS} days`);
  }

  const addedWithinDays = parseDaysFilter(input.addedWithinDays, "Added within");
  const addedBeforeDays = parseDaysFilter(input.addedBeforeDays, "In system for more than");
  let activeWithinDays = parseDaysFilter(input.activeWithinDays, "Messaged within");
  const activeBeforeDays = parseDaysFilter(input.activeBeforeDays, "Last message older than");
  if (!activeWithinDays && audienceDays) {
    activeWithinDays = parseDaysFilter(audienceDays, "Messaged within");
  }

  if (addedWithinDays && addedBeforeDays && addedWithinDays <= addedBeforeDays) {
    throw new Error(
      `Impossible audience: cannot be added within ${addedWithinDays} days and older than ${addedBeforeDays} days at the same time`
    );
  }
  if (activeWithinDays && activeBeforeDays && activeWithinDays <= activeBeforeDays) {
    throw new Error(
      `Impossible audience: cannot have messaged within ${activeWithinDays} days and not for ${activeBeforeDays} days at the same time`
    );
  }

  const filters = {
    addedWithinDays,
    addedBeforeDays,
    activeWithinDays,
    activeBeforeDays,
    audienceSource,
    audienceStatus,
    cooldownDays,
  };

  // Validate the template BEFORE anything else — otherwise the campaign fails
  // at send time with 132012 and the numbers are burned on failed attempts.
  const templates = await getTemplates();
  const tpl = templates.find((t) => t.name === templateName && t.language === templateLanguage);
  if (!tpl) {
    throw new Error(
      `Template "${templateName}" (${templateLanguage}) was not found among your approved templates`
    );
  }
  if (tpl.variableCount !== variables.length) {
    throw new Error(
      `Template "${templateName}" expects ${tpl.variableCount} variable(s) but ${variables.length} were provided`
    );
  }
  if (tpl.headerVariableCount > 0) {
    throw new Error(
      `Template "${templateName}" has a text header with a variable, which is not supported yet. Use a template without one.`
    );
  }
  if (tpl.buttonVariableCount > 0) {
    throw new Error(
      `Template "${templateName}" has a button with a dynamic URL, which is not supported yet. Use a template without one.`
    );
  }

  let headerMediaId = null;
  const headerFormat = tpl.headerNeedsMedia ? tpl.headerFormat : null;
  if (headerFormat) {
    if (!headerMediaUrl) {
      throw new Error(
        `Template "${templateName}" has a ${headerFormat} header. Attach a file with the "image" option — the preview image in Meta is only a review sample and is not sent.`
      );
    }
    const limit = SIZE_LIMITS[headerFormat.toLowerCase()] || SIZE_LIMITS.image;
    const file = await downloadUrl(headerMediaUrl, limit, `header-${Date.now()}`);
    if (!file) {
      throw new Error(
        "Could not download the attached file, or it is larger than the allowed size"
      );
    }
    headerMediaId = await uploadMedia(file.blob, file.fileName, file.mimeType);
    console.log(`[Campaign] Header media uploaded: ${headerMediaId}`);
  }

  const leads = await loadLeads(workspaceId);
  const { eligible, funnel } = filterEligible(leads, filters);
  if (eligible.length === 0) {
    const culprit = findEmptyingStep(funnel);
    throw new Error(
      culprit
        ? `No eligible recipients — "${culprit.label}" removed all ${culprit.in} remaining contact(s)`
        : "No eligible recipients for these settings"
    );
  }

  const targetingByAddedDate = Boolean(addedWithinDays || addedBeforeDays);
  const targetingByActivity = Boolean(activeWithinDays || activeBeforeDays);
  if (targetingByAddedDate && !targetingByActivity) {
    eligible.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    eligible.sort((a, b) => {
      const aTime = a.lastInboundAt?.getTime() || 0;
      const bTime = b.lastInboundAt?.getTime() || 0;
      if (aTime !== bTime) return bTime - aTime;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  const batch = eligible.slice(0, MAX_BATCH);
  const deferredToNextBatch = eligible.length - batch.length;

  const campaign = await prisma.campaign.create({
    data: {
      workspaceId,
      name,
      templateName,
      templateLanguage,
      variables,
      audienceDays: activeWithinDays || 0,
      addedWithinDays,
      addedBeforeDays,
      activeWithinDays,
      activeBeforeDays,
      audienceSource,
      audienceStatus,
      cooldownDays,
      headerMediaId,
      headerFormat,
      templateVariableNames: tpl.usesNamedParams ? tpl.variableNames : undefined,
      status: "DRAFT",
      totalRecipients: batch.length,
      createdById,
      createdByName,
      excludedBreakdown: funnel,
      // The unique (campaignId, leadId) constraint prevents double sends
      recipients: { createMany: { data: batch.map((l) => ({ leadId: l.id })) } },
    },
  });

  console.log(`[Campaign] Created "${name}" with ${batch.length} recipient(s)`);
  return {
    campaign,
    eligible: batch.length,
    funnel,
    deferredToNextBatch,
    preview: batch.slice(0, 30).map((l) => ({ name: l.name, phone: l.phone })),
    audienceLabel: describeAudience({
      addedWithinDays,
      addedBeforeDays,
      activeWithinDays,
      activeBeforeDays,
      audienceSource,
      audienceStatus,
    }),
  };
}

function describeAudience(c) {
  const parts = [];
  if (c.addedWithinDays) parts.push(`added in the last ${c.addedWithinDays} day(s)`);
  if (c.addedBeforeDays) parts.push(`in the system for more than ${c.addedBeforeDays} day(s)`);
  if (c.activeWithinDays) parts.push(`messaged us in the last ${c.activeWithinDays} day(s)`);
  if (c.activeBeforeDays) parts.push(`last message older than ${c.activeBeforeDays} day(s)`);
  if (c.audienceSource) parts.push(`source: ${c.audienceSource}`);
  if (c.audienceStatus) parts.push(`status: ${c.audienceStatus}`);
  if (parts.length === 0 && c.audienceDays) {
    parts.push(`messaged us in the last ${c.audienceDays} day(s)`);
  }
  return parts.length ? parts.join(" · ") : "Everyone reachable";
}

async function startCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status === "RUNNING") throw new Error("Campaign is already running");
  if (campaign.status === "DONE") throw new Error("Campaign has already finished");
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING", startedAt: campaign.startedAt || new Date() },
  });
  console.log(`[Campaign] Started "${campaign.name}"`);
  startEngine();
  return updated;
}

async function stopCampaign(workspaceId, campaignId) {
  const campaign = await prisma.campaign.update({
    where: { id: campaignId, workspaceId },
    data: { status: "PAUSED" },
  });
  console.log(`[Campaign] Paused "${campaign.name}"`);
  return campaign;
}

// ==========================================
// Engine (deployment-level: one WhatsApp number per deployment)
// ==========================================
let timer = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "asc" },
    });
    if (!campaign) {
      stopEngine();
      return;
    }
    const recipient = await prisma.campaignRecipient.findFirst({
      where: {
        campaignId: campaign.id,
        status: { in: ["PENDING", "DEFERRED"] },
        attempts: { lt: MAX_ATTEMPTS },
      },
      include: { lead: true },
      orderBy: { id: "asc" },
    });
    if (!recipient) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "DONE", finishedAt: new Date() },
      });
      console.log(`[Campaign] Finished "${campaign.name}"`);
      return;
    }
    await sendToRecipient(campaign, recipient);
  } catch (error) {
    console.error("[Campaign] Tick failed:", error.message);
  } finally {
    ticking = false;
  }
}

async function sendToRecipient(campaign, recipient) {
  const lead = recipient.lead;
  if (lead.optedOutAt || !lead.phone) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", error: "Lead opted out or has no phone" },
    });
    return;
  }

  // Re-check cooldown at send time — another campaign may have reached this
  // contact between preview and confirmation.
  const cooldownCutoff = daysAgo(campaign.cooldownDays || DEFAULT_COOLDOWN_DAYS);
  if (lead.lastMarketingAt && lead.lastMarketingAt >= cooldownCutoff) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "FAILED",
        error: `Skipped: another campaign reached this contact within the ${campaign.cooldownDays}-day cooldown`,
      },
    });
    console.log(`[Campaign] Skipped ${lead.phone}: inside cooldown at send time`);
    return;
  }

  const values = (campaign.variables || []).map((v) =>
    String(v).replace(/{name}/gi, lead.name || "there")
  );

  try {
    const waMessageId = await sendTemplate(
      lead.phone,
      campaign.templateName,
      campaign.templateLanguage,
      values,
      {
        headerMediaId: campaign.headerMediaId,
        headerFormat: campaign.headerFormat,
        variableNames: campaign.templateVariableNames || null,
      }
    );
    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "SENT",
          waMessageId,
          sentAt: new Date(),
          attempts: { increment: 1 },
          error: null,
        },
      }),
      prisma.campaign.update({
        where: { id: campaign.id },
        data: { sentCount: { increment: 1 } },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: { lastMarketingAt: new Date() },
      }),
      prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: "MESSAGE",
          origin: "AUTOMATION",
          content: `[Campaign] ${campaign.name} - template: ${campaign.templateName}`,
          waMessageId,
        },
      }),
    ]);
  } catch (error) {
    const message = String(error.message || error);
    const isRateLimit = RATE_LIMIT_CODES.some((code) => message.includes(code));
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: isRateLimit ? "DEFERRED" : "FAILED",
        error: message.slice(0, 500),
        attempts: { increment: 1 },
      },
    });
    if (!isRateLimit) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { failedCount: { increment: 1 } },
      });
    }
    console.error(`[Campaign] Send failed for ${lead.phone}: ${message.slice(0, 120)}`);
  }
}

function startEngine() {
  if (timer) return;
  timer = setInterval(tick, SEND_INTERVAL_MS);
  timer.unref?.();
  console.log("[Campaign] Engine started");
}

function stopEngine() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log("[Campaign] Engine idle");
}

async function resumeRunningCampaigns() {
  const count = await prisma.campaign.count({ where: { status: "RUNNING" } });
  if (count > 0) {
    console.log(`[Campaign] Resuming ${count} running campaign(s)`);
    startEngine();
  }
}

// ==========================================
// Queries (workspace-scoped)
// ==========================================

async function getCampaignRecipients(
  workspaceId,
  campaignId,
  { limit = null, status = null } = {}
) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, ...(status ? { status } : {}) },
    include: {
      lead: { select: { name: true, phone: true, createdAt: true, lastInboundAt: true } },
    },
    orderBy: { id: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  return {
    campaignId,
    campaignName: campaign.name,
    total: campaign.totalRecipients,
    returned: recipients.length,
    recipients: recipients.map((r) => ({
      name: r.lead?.name || "Unknown",
      phone: r.lead?.phone || "N/A",
      status: r.status,
      error: r.error || null,
      addedAt: r.lead?.createdAt || null,
      lastInboundAt: r.lead?.lastInboundAt || null,
    })),
  };
}

async function getCampaignProgress(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");
  const counts = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });
  const byStatus = {};
  for (const c of counts) byStatus[c.status] = c._count;
  const sent = byStatus.SENT || 0;
  const remaining = (byStatus.PENDING || 0) + (byStatus.DEFERRED || 0);
  const etaMinutes = Math.ceil((remaining * SEND_INTERVAL_MS) / 60000);
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    total: campaign.totalRecipients,
    sent,
    failed: byStatus.FAILED || 0,
    deferred: byStatus.DEFERRED || 0,
    pending: byStatus.PENDING || 0,
    remaining,
    etaMinutes,
  };
}

// Counts replies that arrived after the campaign started — the real success metric
async function countReplies(campaign) {
  if (!campaign.startedAt) return 0;
  return prisma.interaction.count({
    where: {
      origin: "CUSTOMER",
      createdAt: { gte: campaign.startedAt },
      lead: { campaignRecipients: { some: { campaignId: campaign.id, status: "SENT" } } },
    },
  });
}

async function listCampaigns(workspaceId, limit = 10) {
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return Promise.all(
    campaigns.map(async (c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      total: c.totalRecipients,
      sent: c.sentCount,
      failed: c.failedCount,
      replies: await countReplies(c),
      createdAt: c.createdAt,
      createdByName: c.createdByName,
    }))
  );
}

async function getCampaignInfo(workspaceId, campaignId) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new Error("Campaign not found");
  const progress = await getCampaignProgress(workspaceId, campaignId);
  const replies = await countReplies(campaign);
  const failures = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "FAILED" },
    include: { lead: { select: { name: true, phone: true } } },
    take: 5,
  });
  return {
    ...progress,
    replies,
    templateName: campaign.templateName,
    audienceLabel: describeAudience(campaign),
    addedWithinDays: campaign.addedWithinDays,
    addedBeforeDays: campaign.addedBeforeDays,
    activeWithinDays: campaign.activeWithinDays,
    activeBeforeDays: campaign.activeBeforeDays,
    audienceSource: campaign.audienceSource,
    audienceStatus: campaign.audienceStatus,
    cooldownDays: campaign.cooldownDays,
    excludedBreakdown: campaign.excludedBreakdown,
    createdByName: campaign.createdByName,
    startedAt: campaign.startedAt,
    finishedAt: campaign.finishedAt,
    sampleFailures: failures.map((f) => ({
      name: f.lead?.name,
      phone: f.lead?.phone,
      error: f.error,
    })),
  };
}

async function findCampaigns(workspaceId, statuses = null, limit = 25) {
  return prisma.campaign.findMany({
    where: {
      workspaceId,
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, name: true, status: true },
  });
}

module.exports = {
  getAudienceStats,
  createCampaign,
  startCampaign,
  stopCampaign,
  getCampaignProgress,
  getCampaignInfo,
  getCampaignRecipients,
  listCampaigns,
  findCampaigns,
  resumeRunningCampaigns,
  describeAudience,
  MIN_COOLDOWN_DAYS,
  MAX_BATCH,
  MAX_FILTER_DAYS,
  DEFAULT_COOLDOWN_DAYS,
};
