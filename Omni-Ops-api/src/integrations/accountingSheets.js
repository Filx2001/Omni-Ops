const isConfigured = () =>
  Boolean(process.env.ACCOUNTING_SHEET_ID && process.env.GOOGLE_CREDENTIALS_JSON);

async function syncClassToAccountingSheet(cls) {
  if (!isConfigured()) return;
}
async function syncAppointmentToAccountingSheet(appt) {
  if (!isConfigured()) return;
}
async function syncEventToAccountingSheet(event) {
  if (!isConfigured()) return;
}
async function removeRecordFromAccountingSheet(id) {
  if (!isConfigured()) return;
}
async function backfillAccountingSheet(classes, events) {
  if (!isConfigured()) return 0;
}

module.exports = {
  syncClassToAccountingSheet,
  syncAppointmentToAccountingSheet,
  syncEventToAccountingSheet,
  removeRecordFromAccountingSheet,
  backfillAccountingSheet,
};
