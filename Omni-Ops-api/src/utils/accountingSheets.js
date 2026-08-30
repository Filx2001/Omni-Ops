const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const shortId = (id) => String(id).split("-")[0];
const recordKey = (mainId, subId) => `${shortId(mainId)}:${subId ? shortId(subId) : "x"}`;

let creds;
if (process.env.GOOGLE_CREDS) {
  creds = JSON.parse(process.env.GOOGLE_CREDS);
} else {
  creds = require("../../coding-hub-sheets.json");
}

const TZ = "Asia/Qatar";
const HEADERS = [
  "Type",
  "Subject / Title",
  "Teacher / Assignees",
  "Date",
  "Day",
  "Time",
  "Room",
  "Payment (QAR)",
  "Notes",
  "Record ID",
];

async function getDoc() {
  if (!process.env.ACCOUNTING_SHEETS_ID) {
    throw new Error("⚠️ ACCOUNTING_SHEETS_ID is missing in environment variables!");
  }
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  const doc = new GoogleSpreadsheet(process.env.ACCOUNTING_SHEETS_ID, auth);
  await doc.loadInfo();
  return doc;
}

const monthTitle = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: TZ });
const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { timeZone: TZ });
const fmtDay = (d) => new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

async function getOrCreateTab(doc, title) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: HEADERS });
    console.log(`🆕 Accounting Sheet: created tab [${title}]`);
  }
  return sheet;
}

function classPayload(cls) {
  // نفس منطق الاسم البديل بتاع calendar.service
  const label =
    cls.subject ||
    `${cls.teacher?.name || "TBA"} Class - ${new Date(cls.startTime).getDate()}/${new Date(cls.startTime).getMonth() + 1}`;

  return {
    Type: "Class",
    "Subject / Title": label,
    "Teacher / Assignees": cls.teacher?.name || "TBA",
    Date: fmtDate(cls.startTime),
    Day: cls.day || fmtDay(cls.startTime),
    Time: cls.isAllDay ? "All day" : `${fmtTime(cls.startTime)} - ${fmtTime(cls.endTime)}`,
    Room: cls.room || "TBA",
    "Record ID": recordKey(cls.id),
  };
}

// 🌟 تعديل جذري لفك الأيام الممتدة بشكل آمن
function eventPayloads(event) {
  const typeLabel = event.type
    ? event.type.charAt(0).toUpperCase() + event.type.slice(1).replace("_", " ")
    : "Event";
  const assignees = event.assignees || [];
  const payloads = [];

  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);

  const daysToCover = [];
  let currentDay = new Date(startDate);
  currentDay.setHours(0, 0, 0, 0);

  let lastDay = new Date(endDate);
  lastDay.setHours(0, 0, 0, 0);

  if (event.isAllDay && lastDay > currentDay) {
    if (new Date(event.endDate).getHours() === 0) {
      lastDay.setDate(lastDay.getDate() - 1);
    }
  }

  while (currentDay <= lastDay) {
    daysToCover.push(new Date(currentDay));
    currentDay.setDate(currentDay.getDate() + 1);
  }

  for (let i = 0; i < daysToCover.length; i++) {
    const d = daysToCover[i];
    const isMultiDay = daysToCover.length > 1;
    // 🌟 بنضيف رقم اليوم للـ ID عشان الفعاليات القديمة تتفكك لصفوف مختلفة متمسحش بعض
    const daySuffix = isMultiDay ? `-${d.getDate()}` : "";

    const base = {
      Type: typeLabel,
      "Subject / Title": event.title || "Unknown",
      Date: fmtDate(d),
      Day: fmtDay(d),
      Time: event.isAllDay ? "All day" : `${fmtTime(event.startDate)} - ${fmtTime(event.endDate)}`,
      Room: "—",
    };

    if (!assignees.length) {
      payloads.push({
        ...base,
        "Teacher / Assignees": "—",
        "Record ID": recordKey(event.id, "none") + daySuffix,
      });
    } else {
      assignees.forEach((a) => {
        payloads.push({
          ...base,
          "Teacher / Assignees": a.name || "Unknown",
          "Record ID": recordKey(event.id, a.id) + daySuffix,
        });
      });
    }
  }

  return payloads;
}

async function findRecordRows(doc, recordId) {
  const found = [];
  for (const sheet of doc.sheetsByIndex) {
    let rows = [];
    try {
      rows = await sheet.getRows();
    } catch (e) {
      continue;
    }
    for (const row of rows) {
      const rid = row.get("Record ID") || "";
      if (rid.startsWith(`${shortId(recordId)}:`)) found.push({ sheet, row });
    }
  }
  return found;
}

async function upsertRecord(recordId, wanted) {
  const doc = await getDoc();
  const existing = await findRecordRows(doc, recordId);
  const wantedKeys = new Set(wanted.map((w) => `${w.title}::${w.payload["Record ID"]}`));

  for (const { sheet, row } of existing) {
    const key = `${sheet.title}::${row.get("Record ID")}`;
    if (!wantedKeys.has(key)) await row.delete();
  }

  for (const { title, payload, notes } of wanted) {
    const match = existing.find(
      (e) => e.sheet.title === title && e.row.get("Record ID") === payload["Record ID"]
    );
    if (match && !match.row.deleted) {
      match.row.assign(payload);
      await match.row.save();
    } else {
      const sheet = await getOrCreateTab(doc, title);
      await sheet.addRow({ ...payload, "Payment (QAR)": "", Notes: notes || "" });
    }
  }
}

async function syncClassToAccountingSheet(cls) {
  try {
    await upsertRecord(cls.id, [{ title: monthTitle(cls.startTime), payload: classPayload(cls) }]);
    console.log(`✅ Accounting Sheet: synced class [${cls.subject}]`);
  } catch (err) {
    console.error("❌ Accounting Sheet Sync Error (class):", err.message);
  }
}

async function syncEventToAccountingSheet(event) {
  try {
    const wanted = eventPayloads(event).map((payload) => {
      // بنستخرج التاريخ من الـ Date اللي بصيغة DD/MM/YYYY عشان نحدد التاب الصحيح
      const parts = payload.Date.split("/");
      const payloadDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      return { title: monthTitle(payloadDate), payload, notes: "" };
    });

    await upsertRecord(event.id, wanted);
    console.log(`✅ Accounting Sheet: synced event day [${event.title}]`);
  } catch (err) {
    console.error("❌ Accounting Sheet Sync Error (event):", err.message);
  }
}

async function removeRecordFromAccountingSheet(recordId) {
  try {
    const doc = await getDoc();
    const existing = await findRecordRows(doc, recordId);
    for (const { row } of existing) await row.delete();
    if (existing.length) console.log(`🗑️ Accounting Sheet: removed record ${recordId}`);
  } catch (err) {
    console.error("❌ Accounting Sheet Delete Error:", err.message);
  }
}

async function backfillAccountingSheet(classes, events) {
  const doc = await getDoc();
  const existingIds = new Set();
  for (const sheet of doc.sheetsByIndex) {
    let rows = [];
    try {
      rows = await sheet.getRows();
    } catch (e) {
      continue;
    }
    for (const row of rows) {
      const id = row.get("Record ID");
      if (id) existingIds.add(`${sheet.title}::${id}`);
    }
  }

  const rowsByTab = new Map();
  const queue = (title, payload) => {
    if (!rowsByTab.has(title)) rowsByTab.set(title, []);
    rowsByTab.get(title).push({ ...payload, "Payment (QAR)": "", Notes: payload.__notes || "" });
  };

  for (const cls of classes) {
    const title = monthTitle(cls.startTime);
    if (!existingIds.has(`${title}::${recordKey(cls.id)}`)) queue(title, classPayload(cls));
  }

  for (const ev of events) {
    for (const payload of eventPayloads(ev)) {
      const parts = payload.Date.split("/");
      const payloadDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      const title = monthTitle(payloadDate);

      if (!existingIds.has(`${title}::${payload["Record ID"]}`)) {
        queue(title, { ...payload, __notes: "" });
      }
    }
  }

  let added = 0;
  for (const [title, rows] of rowsByTab) {
    const cleanRows = rows.map(({ __notes, ...r }) => r);
    const sheet = await getOrCreateTab(doc, title);
    await sheet.addRows(cleanRows);
    added += cleanRows.length;
  }
  return added;
}

module.exports = {
  syncClassToAccountingSheet,
  syncEventToAccountingSheet,
  removeRecordFromAccountingSheet,
  backfillAccountingSheet,
};
