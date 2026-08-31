const isConfigured = () =>
  Boolean(process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_CREDENTIALS_JSON);

async function syncLeadToGoogleSheet(lead) {
  if (!isConfigured()) return;
  // TODO: Implement actual sheet sync if configured
}

async function deleteLeadFromSheet(lead) {
  if (!isConfigured()) return;
}

async function rebuildLeadsSheet(leads) {
  if (!isConfigured()) return { tabs: 0, rows: 0, clearedTabs: 0 };
  return { tabs: 0, rows: 0, clearedTabs: 0 };
}

module.exports = { syncLeadToGoogleSheet, deleteLeadFromSheet, rebuildLeadsSheet };
