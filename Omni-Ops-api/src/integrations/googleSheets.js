const googleAuth = require("./googleAuth");

const sheetId = (ws) => ws?.googleLeadsSheetId || process.env.GOOGLE_SHEETS_ID;
const leadRow = (l) => [
  l.name || "",
  l.phone || "",
  l.email || "",
  l.source || "",
  l.status || "",
  l.createdAt ? new Date(l.createdAt).toISOString() : "",
];

async function syncLeadToGoogleSheet(lead) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(lead.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return;
    await googleAuth.appendRow(ctx.auth, id, "Leads", leadRow(lead));
  } catch (e) {
    console.error("[Sheets] syncLead failed:", e.message);
  }
}

async function deleteLeadFromSheet(lead) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(lead.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return;
    await googleAuth.deleteRowByValue(ctx.auth, id, "Leads", 1, lead.phone);
  } catch (e) {
    console.error("[Sheets] deleteLead failed:", e.message);
  }
}

async function rebuildLeadsSheet(leads) {
  try {
    const ctx = await googleAuth.getAuthForWorkspace(leads[0]?.workspaceId);
    const id = sheetId(ctx?.ws);
    if (!ctx?.auth || !id) return { tabs: 0, rows: 0, clearedTabs: 0 };
    await googleAuth.rewriteTab(ctx.auth, id, "Leads", [
      googleAuth.LEADS_HEADER,
      ...leads.map(leadRow),
    ]);
    return { tabs: 1, rows: leads.length, clearedTabs: 1 };
  } catch (e) {
    console.error("[Sheets] rebuildLeads failed:", e.message);
    return { tabs: 0, rows: 0, clearedTabs: 0 };
  }
}

module.exports = { syncLeadToGoogleSheet, deleteLeadFromSheet, rebuildLeadsSheet };
