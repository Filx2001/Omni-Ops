const crypto = require("crypto");
const { google } = require("googleapis");
const prisma = require("../prisma");
const { encrypt, decrypt } = require("../utils/crypto");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

/* ─────────────── OAuth client (host-level, created once in Google Cloud) ─────────────── */
function getOAuthClient() {
  if (
    !process.env.GOOGLE_OAUTH_CLIENT_ID ||
    !process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !process.env.API_PUBLIC_URL
  )
    return null;
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${process.env.API_PUBLIC_URL}/google/callback`
  );
}

/* ─────────────── Signed state (anti-forgery) ─────────────── */
const sign = (wsId) =>
  crypto
    .createHmac("sha256", process.env.INTERNAL_API_KEY || "dev")
    .update(wsId)
    .digest("hex");

function buildConnectUrl(externalWorkspaceId) {
  const client = getOAuthClient();
  if (!client || !externalWorkspaceId) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: `${externalWorkspaceId}.${sign(externalWorkspaceId)}`,
  });
}

function verifyState(state) {
  const [wsId, sig] = String(state || "").split(".");
  return wsId && sig === sign(wsId) ? wsId : null;
}

/* ─────────────── Callback: exchange code → save token → auto-provision ─────────────── */
async function handleCallback(code, externalWorkspaceId) {
  const ws = await prisma.workspace.findFirst({ where: { workspaceId: externalWorkspaceId } });
  if (!ws) throw new Error("Workspace not found");

  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let email = null;
  try {
    email = (await google.oauth2({ version: "v2", auth: client }).userinfo.get()).data.email;
  } catch {}

  await prisma.workspace.update({
    where: { id: ws.id },
    data: {
      googleEmail: email,
      ...(tokens.refresh_token ? { googleRefreshToken: encrypt(tokens.refresh_token) } : {}),
    },
  });

  await provisionGoogleResources(ws.id);
  return email;
}

/* ─────────────── Per-workspace auth (OAuth → host service-account fallback) ─────────────── */
function hostFallback() {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) return null;
  try {
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
      scopes: SCOPES,
    });
  } catch {
    return null;
  }
}

async function getAuthForWorkspace(workspaceId) {
  let ws = null;
  if (workspaceId) ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (ws?.googleRefreshToken && getOAuthClient()) {
    const client = getOAuthClient();
    client.setCredentials({ refresh_token: decrypt(ws.googleRefreshToken) });
    return { auth: client, ws };
  }
  const host = hostFallback();
  return host ? { auth: host, ws } : null;
}

/* ─────────────── Auto-provisioning: creates calendar + 3 sheets with correct tabs ─────────────── */
const LEADS_HEADER = ["Name", "Phone", "Email", "Source", "Status", "Created At"];
const APPT_HEADER = ["ID", "Title", "Assignee", "Day", "Start", "End", "Location"];
const EVENT_HEADER = ["ID", "Title", "Type", "Start", "End"];
const TASK_HEADER = ["ID", "Title", "Priority", "Due Date", "Status"];
const INVOICE_HEADER = [
  "Invoice #",
  "Customer",
  "Category",
  "Description",
  "Qty",
  "Discount %",
  "Net",
  "Status",
  "Date",
];

async function createSheet(auth, title, tabs) {
  const sheets = google.sheets({ version: "v4", auth });
  const sh = await sheets.spreadsheets.create({
    resource: {
      properties: { title },
      sheets: tabs.map((t) => ({ properties: { title: t.name } })),
    },
  });
  const id = sh.data.spreadsheetId;
  for (const t of tabs) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${t.name}!A1`,
      valueInputOption: "RAW",
      resource: { values: [t.header] },
    });
  }
  return id;
}

async function provisionGoogleResources(workspaceId) {
  const ctx = await getAuthForWorkspace(workspaceId);
  if (!ctx?.auth || !ctx.ws) return null;
  const ws = ctx.ws;
  const update = {};

  try {
    if (!ws.googleCalendarId) {
      const cal = await google.calendar({ version: "v3", auth: ctx.auth }).calendars.insert({
        resource: { summary: `${ws.organizationName} — Omni-Ops`, timeZone: ws.timezone || "UTC" },
      });
      update.googleCalendarId = cal.data.id;
    }
  } catch (e) {
    console.error("[Google] calendar provision failed:", e.message);
  }

  try {
    if (!ws.googleLeadsSheetId)
      update.googleLeadsSheetId = await createSheet(ctx.auth, `${ws.organizationName} — Leads`, [
        { name: "Leads", header: LEADS_HEADER },
      ]);
  } catch (e) {
    console.error("[Google] leads sheet provision failed:", e.message);
  }

  try {
    if (!ws.googleScheduleSheetId)
      update.googleScheduleSheetId = await createSheet(
        ctx.auth,
        `${ws.organizationName} — Schedule`,
        [
          { name: "Appointments", header: APPT_HEADER },
          { name: "Events", header: EVENT_HEADER },
        ]
      );
  } catch (e) {
    console.error("[Google] schedule sheet provision failed:", e.message);
  }

  try {
    if (!ws.googleAccountingSheetId)
      update.googleAccountingSheetId = await createSheet(
        ctx.auth,
        `${ws.organizationName} — Accounting`,
        [{ name: "Invoices", header: INVOICE_HEADER }]
      );
  } catch (e) {
    console.error("[Google] accounting sheet provision failed:", e.message);
  }

  try {
    if (!ws.googlePersonalSheetId)
      update.googlePersonalSheetId = await createSheet(
        ctx.auth,
        `${ws.organizationName} — Personal Tasks`,
        [{ name: "Tasks", header: TASK_HEADER }]
      );
  } catch (e) {
    console.error("[Google] personal sheet provision failed:", e.message);
  }

  if (Object.keys(update).length)
    await prisma.workspace.update({ where: { id: workspaceId }, data: update });
  return update;
}

/* ─────────────── Shared sheet helpers (used by the 3 sheet integrations) ─────────────── */
const sheetsClient = (auth) => google.sheets({ version: "v4", auth });

async function appendRow(auth, spreadsheetId, tab, row) {
  await sheetsClient(auth).spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: { values: [row] },
  });
}

async function rewriteTab(auth, spreadsheetId, tab, rows) {
  const sheets = sheetsClient(auth);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tab}!A2:ZZZ` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    resource: { values: rows },
  });
}

async function getSheetId(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sh = (meta.data.sheets || []).find((s) => s.properties.title === title);
  return sh ? sh.properties.sheetId : 0;
}

async function deleteRowByValue(auth, spreadsheetId, tab, colIndex, value) {
  const sheets = sheetsClient(auth);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][colIndex] || "") === String(value ?? "")) {
      const sheetId = await getSheetId(sheets, spreadsheetId, tab);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 },
              },
            },
          ],
        },
      });
      return true;
    }
  }
  return false;
}

module.exports = {
  getOAuthClient,
  buildConnectUrl,
  verifyState,
  handleCallback,
  getAuthForWorkspace,
  provisionGoogleResources,
  sheetsClient,
  appendRow,
  rewriteTab,
  deleteRowByValue,
  LEADS_HEADER,
  APPT_HEADER,
  EVENT_HEADER,
  TASK_HEADER,
  INVOICE_HEADER,
};
