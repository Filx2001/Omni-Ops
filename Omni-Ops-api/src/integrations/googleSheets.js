// Leads → per-workspace Google Sheet with monthly tabs ("September 2026").
const engine = require("./sheetEngine");

const HEADERS = [
  "Lead Name",
  "Phone",
  "Status",
  "Assigned To",
  "Source",
  "Score",
  "Created At",
  "Notes",
  "Lead ID",
];
const STATUS_MAP = {
  NEW: "🆕 New",
  CONTACTED: "📞 Contacted",
  QUALIFIED: "⭐ Qualified",
  CONVERTED: "✅ Converted",
  LOST: "🚫 Not Interested",
};
const SOURCE_MAP = {
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  MANUAL: "Manual",
  IMPORT: "Import",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
  SOCIAL: "Social",
};
const normalizePhone = (p) => String(p || "").replace(/\D/g, "");

const tabForLead = (lead, tz) => engine.monthTitle(lead.createdAt || Date.now(), tz);

function buildRowPayload(lead, tz) {
  return {
    "Lead Name": lead.name || "Unknown",
    Phone: lead.phone ? `'${lead.phone}` : "N/A",
    Status: STATUS_MAP[lead.status] || lead.status || "New",
    "Assigned To": lead.assignedTo?.name || "Not Assigned",
    Source: SOURCE_MAP[lead.source] || lead.source || "WhatsApp",
    Score: String(lead.score || 0),
    "Created At": engine.fmtDateTime(lead.createdAt, tz),
    Notes: lead.notes || "",
    "Lead ID": lead.id,
  };
}

function findLeadRow(rows, lead) {
  const targetPhone = normalizePhone(lead.phone);
  return rows.find((row) => {
    if (row.get("Lead ID") === lead.id) return true;
    return Boolean(targetPhone) && normalizePhone(row.get("Phone")) === targetPhone;
  });
}

async function syncLeadToGoogleSheet(lead) {
  if (!lead?.id) return;
  try {
    const ctx = await engine.getSheetContext(lead.workspaceId, "googleLeadsSheetId");
    if (!ctx) return;
    const tz = ctx.ws.timezone;
    await engine.withDoc(lead.workspaceId, ctx.ws.googleLeadsSheetId, async (doc) => {
      const sheet = await engine.getOrCreateTab(doc, tabForLead(lead, tz), HEADERS);
      const rows = await sheet.getRows();
      const existing = findLeadRow(rows, lead);
      const payload = buildRowPayload(lead, tz);
      if (existing) {
        existing.assign(payload);
        await existing.save();
      } else await sheet.addRow(payload);
    });
  } catch (err) {
    console.error("[Leads Sheet] sync failed:", err.message);
  }
}

async function deleteLeadFromSheet(lead) {
  if (!lead?.id) return;
  try {
    const ctx = await engine.getSheetContext(lead.workspaceId, "googleLeadsSheetId");
    if (!ctx) return;
    await engine.withDoc(lead.workspaceId, ctx.ws.googleLeadsSheetId, async (doc) => {
      for (const sheet of doc.sheetsByIndex) {
        let rows = [];
        try {
          rows = await sheet.getRows();
        } catch {
          continue;
        }
        const row = findLeadRow(rows, lead);
        if (row) {
          await row.delete();
          return;
        }
      }
    });
  } catch (err) {
    console.error("[Leads Sheet] delete failed:", err.message);
  }
}

async function rebuildLeadsSheet(leads) {
  const stats = { tabs: 0, rows: 0, clearedTabs: 0 };
  if (!leads?.length) return stats;
  const wsId = leads[0].workspaceId;
  const ctx = await engine.getSheetContext(wsId, "googleLeadsSheetId");
  if (!ctx) return stats;
  const tz = ctx.ws.timezone;
  await engine.withDoc(wsId, ctx.ws.googleLeadsSheetId, async (doc) => {
    const groups = new Map();
    for (const lead of leads) {
      const title = tabForLead(lead, tz);
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(buildRowPayload(lead, tz));
    }
    for (const [title, rows] of groups) {
      const sheet = await engine.getOrCreateTab(doc, title, HEADERS);
      await sheet.setHeaderRow(HEADERS);
      await sheet.clearRows().catch(() => {});
      if (rows.length) await sheet.addRows(rows);
      stats.tabs++;
      stats.rows += rows.length;
    }
    for (const sheet of doc.sheetsByIndex) {
      if (groups.has(sheet.title) || !engine.isMonthTab(sheet.title)) continue;
      await sheet.clearRows().catch(() => {});
      stats.clearedTabs++;
    }
  });
  return stats;
}

module.exports = { syncLeadToGoogleSheet, deleteLeadFromSheet, rebuildLeadsSheet };
