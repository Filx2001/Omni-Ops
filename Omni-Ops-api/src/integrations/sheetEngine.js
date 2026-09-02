// Core engine for monthly-tab Google Sheets sync (per-tenant OAuth).
// Handles: connection caching, serial write queue, month-tab helpers.
const { GoogleSpreadsheet } = require("google-spreadsheet");
const googleAuth = require("./googleAuth");

/* ---------- per-workspace doc cache ---------- */
const docCache = new Map(); // key: `${workspaceId}:${spreadsheetId}`

async function loadDoc(workspaceId, spreadsheetId) {
  const key = `${workspaceId}:${spreadsheetId}`;
  const hit = docCache.get(key);
  if (hit) return hit;

  const ctx = await googleAuth.getAuthForWorkspace(workspaceId);
  if (!ctx?.auth) return null; // Google not connected for this workspace

  const doc = new GoogleSpreadsheet(spreadsheetId, ctx.auth);
  await doc.loadInfo();
  docCache.set(key, doc);
  return doc;
}

function resetDoc(workspaceId, spreadsheetId) {
  docCache.delete(`${workspaceId}:${spreadsheetId}`);
}

/* ---------- serial queue per workspace ---------- */
// All writes for one workspace go through here, one at a time.
// Without it: two syncs at the same instant both read "no row" → duplicate rows.
const queues = new Map();
function enqueue(workspaceId, task) {
  const prev = queues.get(workspaceId) || Promise.resolve();
  const next = prev.then(task, task);
  queues.set(
    workspaceId,
    next.catch(() => {})
  );
  return next;
}

/* ---------- safe runner: queue + cache + auto-reset on error ---------- */
async function withDoc(workspaceId, spreadsheetId, fn) {
  return enqueue(workspaceId, async () => {
    try {
      const doc = await loadDoc(workspaceId, spreadsheetId);
      if (!doc) return null;
      return await fn(doc);
    } catch (err) {
      resetDoc(workspaceId, spreadsheetId); // next attempt gets a fresh connection
      throw err;
    }
  });
}

/* ---------- month-tab helpers ---------- */
// "September 2026" in the workspace's OWN timezone
function monthTitle(date, timeZone) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: timeZone || "UTC",
  });
}

// Matches ONLY month tabs ("September 2026") so hand-made tabs are never touched
const MONTH_TAB = /^[A-Z][a-z]+ \d{4}$/;
const isMonthTab = (title) => MONTH_TAB.test(title);

async function getOrCreateTab(doc, title, headers) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: headers });
    console.log(`[Sheets] Created tab [${title}]`);
  }
  return sheet;
}

/* ---------- self-healing: workspaces connected before a sheet existed get it now ---------- */
async function getSheetContext(workspaceId, field) {
  let ctx = await googleAuth.getAuthForWorkspace(workspaceId);
  if (!ctx?.auth || !ctx?.ws) return null;
  if (!ctx.ws[field]) {
    await googleAuth.provisionGoogleResources(workspaceId);
    ctx = await googleAuth.getAuthForWorkspace(workspaceId);
    if (!ctx?.auth || !ctx?.ws?.[field]) return null;
  }
  return ctx;
}

/* ---------- shared date formatters ---------- */
const fmtDate = (d, tz) =>
  d ? new Date(d).toLocaleDateString("en-GB", { timeZone: tz || "UTC" }) : "";
const fmtDay = (d, tz) =>
  d ? new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: tz || "UTC" }) : "";
const fmtTime = (d, tz) =>
  d
    ? new Date(d).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz || "UTC",
      })
    : "";
const fmtDateTime = (d, tz) =>
  d ? new Date(d).toLocaleString("en-US", { timeZone: tz || "UTC" }) : "";

module.exports = {
  withDoc,
  enqueue,
  loadDoc,
  resetDoc,
  monthTitle,
  isMonthTab,
  getOrCreateTab,
  getSheetContext,
  fmtDate,
  fmtDay,
  fmtTime,
  fmtDateTime,
};
