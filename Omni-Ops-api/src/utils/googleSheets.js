const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { normalizePhone } = require("./phone");

const rawCreds = process.env.GOOGLE_CREDS;
let creds;
if (rawCreds) {
  creds = JSON.parse(rawCreds);
} else {
  // fallback محلي بس — على السيرفر لازم يكون المتغير موجود
  creds = require("../../coding-hub-sheets.json");
}
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TZ = "Asia/Qatar";

// ترتيب الأعمدة — لازم يطابق مفاتيح rowPayload بالظبط
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

// ==========================================
// الاتصال — مرة واحدة ونعيد استخدامه
// ==========================================
let cachedDoc = null;

async function getDoc() {
  if (cachedDoc) return cachedDoc;

  if (!SPREADSHEET_ID) {
    throw new Error("GOOGLE_SHEETS_ID is missing in environment variables");
  }

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
  await doc.loadInfo();
  cachedDoc = doc;
  return doc;
}

// "July 2026" — نفس صيغة شيت الحسابات
const monthTitle = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: TZ });

async function getOrCreateTab(doc, title) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: HEADERS });
    console.log(`[Sheets] Created tab [${title}]`);
  }
  return sheet;
}

// تاب العميل بيتحدد من createdAt، وهو مبيتغيرش — فالعميل يفضل في نفس التاب دايماً
const tabForLead = (leadData) => monthTitle(leadData.createdAt || Date.now());

// ==========================================
// طابور تسلسلي
// ==========================================
// كل عمليات الشيت بتمر من هنا وبتتنفذ واحدة ورا التانية.
// من غيره: رسالتين في نفس اللحظة → الاتنين يقروا → الاتنين ميلاقوش الصف → صفين مكررين.
// وكمان بيمنع إنشاء نفس التاب مرتين.
let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

// بيدور على صف العميل بالـ ID الأول، وبالرقم كبديل للصفوف القديمة
function findLeadRow(rows, leadData) {
  const targetPhone = normalizePhone(leadData.phone);

  return rows.find((row) => {
    const rowId = row.get("Lead ID");
    if (rowId && rowId === leadData.id) return true;
    if (!targetPhone) return false;
    return normalizePhone(row.get("Phone")) === targetPhone;
  });
}

const STATUS_MAP = {
  NEW: "🆕 New",
  CONTACTED: "📞 Contacted",
  QUALIFIED: "⭐ Qualified",
  CONVERTED: "✅ Converted",
  LOST: "🚫 Not Interested",
};

const SOURCE_MAP = { WHATSAPP: "WhatsApp", WEBSITE: "Website", MANUAL: "Manual" };
function buildRowPayload(leadData) {
  return {
    "Lead Name": leadData.name || "Unknown",
    // الشرطة العليا بتخلي جوجل شيت يعامل الرقم كنص مش كرقم
    Phone: leadData.phone ? `'${leadData.phone}` : "N/A",
    Status: STATUS_MAP[leadData.status] || "New",
    "Assigned To": leadData.assignedTo?.name || "Not Assigned",
    Source: SOURCE_MAP[leadData.source] || "WhatsApp",
    Score: String(leadData.score || 0),
    "Created At": new Date(leadData.createdAt || Date.now()).toLocaleString("en-US", {
      timeZone: TZ,
    }),
    Notes: leadData.notes || "",
    "Lead ID": leadData.id,
  };
}
async function syncLeadToGoogleSheet(leadData) {
  return enqueue(async () => {
    if (!leadData?.id) return;

    try {
      const doc = await getDoc();
      const title = tabForLead(leadData);
      const sheet = await getOrCreateTab(doc, title);

      // مهم: لو القراءة فشلت بنوقف.
      // الكود القديم كان بيكمل بمصفوفة فاضية وبيضيف صف مكرر.
      const rows = await sheet.getRows();
      const existingRow = findLeadRow(rows, leadData);

      const rowPayload = buildRowPayload(leadData);

      if (existingRow) {
        existingRow.assign(rowPayload);
        await existingRow.save();
        console.log(`[Sheets] Updated ${leadData.name} in [${title}]`);
      } else {
        await sheet.addRow(rowPayload);
        console.log(`[Sheets] Added ${leadData.name} to [${title}]`);
      }
    } catch (err) {
      // بنصفّر الاتصال عشان المحاولة الجاية تعمل واحد جديد
      cachedDoc = null;
      console.error("[Sheets] Sync failed:", err.message);
    }
  });
}

async function deleteLeadFromSheet(leadData) {
  return enqueue(async () => {
    if (!leadData?.id) return;

    try {
      const doc = await getDoc();
      const title = tabForLead(leadData);

      // بندور في تاب العميل الأول
      const primary = doc.sheetsByTitle[title];
      if (primary) {
        const rows = await primary.getRows();
        const row = findLeadRow(rows, leadData);
        if (row) {
          await row.delete();
          console.log(`[Sheets] Deleted ${leadData.name} from [${title}]`);
          return;
        }
      }

      // مش موجود؟ ندور في باقي التابات — للصفوف القديمة قبل التقسيم بالشهور.
      // الحذف عملية نادرة فتكلفة البحث الكامل مقبولة هنا.
      for (const sheet of doc.sheetsByIndex) {
        if (sheet.title === title) continue;
        let rows = [];
        try {
          rows = await sheet.getRows();
        } catch (e) {
          continue;
        }
        const row = findLeadRow(rows, leadData);
        if (row) {
          await row.delete();
          console.log(`[Sheets] Deleted ${leadData.name} from [${sheet.title}]`);
          return;
        }
      }
    } catch (err) {
      cachedDoc = null;
      console.error("[Sheets] Delete failed:", err.message);
    }
  });
}

// أي تاب اسمه زي "July 2026" — عشان نسيب التابات اليدوية في حالها
const MONTH_TAB = /^[A-Z][a-z]+ \d{4}$/;

/**
 * بيعيد بناء الشيت من الداتابيز بالكامل.
 * الداتابيز هي مصدر الحقيقة — أي تعديل يدوي في الشيت بيتشال.
 * بيمر من الطابور عشان ميتزاحمش مع رسايل داخلة.
 */
async function rebuildLeadsSheet(leads) {
  return enqueue(async () => {
    const doc = await getDoc();

    // تجميع العملاء على التاب بتاع شهر إنشائهم
    const groups = new Map();
    for (const lead of leads) {
      const title = tabForLead(lead);
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(buildRowPayload(lead));
    }

    const stats = { tabs: 0, rows: 0, clearedTabs: 0 };

    for (const [title, rows] of groups) {
      const sheet = await getOrCreateTab(doc, title);

      // بنجبر الهيدرز على الترتيب الصح — ده بيصلّح أي عك في أسماء الأعمدة
      await sheet.setHeaderRow(HEADERS);
      await sheet.clearRows().catch(() => {});
      if (rows.length) await sheet.addRows(rows);

      stats.tabs++;
      stats.rows += rows.length;
      console.log(`[Sheets] Rebuilt [${title}] with ${rows.length} row(s)`);
    }

    // تابات شهور مبقالهاش عملاء في الداتابيز (اتمسحوا) — نفضّيها
    for (const sheet of doc.sheetsByIndex) {
      if (groups.has(sheet.title) || !MONTH_TAB.test(sheet.title)) continue;
      await sheet.clearRows().catch(() => {});
      stats.clearedTabs++;
      console.log(`[Sheets] Cleared empty tab [${sheet.title}]`);
    }

    return stats;
  });
}

module.exports = { syncLeadToGoogleSheet, deleteLeadFromSheet, rebuildLeadsSheet };
