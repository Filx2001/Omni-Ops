// مزامنة التاسكات الشخصية (اللي المدير بيعملها لنفسه) لشيت منفصل بتابات شهرية.
// الشيت ده ملف مستقل عن شيت الحسابات — الصلاحيات عليه بتتظبط يدوي من Google Drive.

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const rawCreds = process.env.GOOGLE_CREDS;
let creds;
if (rawCreds) {
  creds = JSON.parse(rawCreds);
} else {
  // fallback محلي بس — على السيرفر لازم يكون المتغير موجود
  creds = require("../../coding-hub-sheets.json");
}

const SHEET_ID = process.env.PERSONAL_TASKS_SHEETS_ID;
const TZ = "Asia/Qatar";

const HEADERS = [
  "Task",
  "Priority",
  "Status",
  "Due Date",
  "Day",
  "Created At",
  "Completed At",
  "Notes",
  "Record ID",
];

const PRIORITY_MAP = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const STATUS_MAP = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

// ==========================================
// الاتصال
// ==========================================
let cachedDoc = null;

async function getDoc() {
  if (cachedDoc) return cachedDoc;

  if (!SHEET_ID) {
    throw new Error("PERSONAL_TASKS_SHEETS_ID is missing in environment variables");
  }

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  await doc.loadInfo();
  cachedDoc = doc;
  return doc;
}

// ==========================================
// طابور تسلسلي — يمنع صفوف مكررة وإنشاء نفس التاب مرتين
// ==========================================
let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

// ==========================================
// أدوات
// ==========================================
const monthTitle = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: TZ });

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: TZ }) : "");

const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ }) : "";

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-US", { timeZone: TZ }) : "");

/** التاسك شخصية لو المدير كلّف نفسه بيها */
const isPersonalTask = (task) =>
  Boolean(task?.assignedToId) && task.assignedToId === task.createdById;

/**
 * التاب بيتحدد من dueDate لو موجود، وإلا createdAt.
 * ملحوظة: dueDate بيتغير — فالصف ممكن يحتاج ينتقل بين تابين.
 */
const tabForTask = (task) => monthTitle(task.dueDate || task.createdAt || Date.now());

async function getOrCreateTab(doc, title) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: HEADERS });
    console.log(`[PersonalTasks] Created tab [${title}]`);
  }
  return sheet;
}

function buildRowPayload(task) {
  return {
    Task: task.title || "Untitled",
    Priority: PRIORITY_MAP[task.priority] || task.priority || "",
    Status: STATUS_MAP[task.status] || task.status || "",
    "Due Date": fmtDate(task.dueDate),
    Day: fmtDay(task.dueDate),
    "Created At": fmtDateTime(task.createdAt),
    "Completed At": fmtDateTime(task.completedAt),
    Notes: task.description || "",
    "Record ID": task.id,
  };
}

/**
 * بيدور على صف التاسك في كل التابات.
 * البحث الكامل مقصود هنا: dueDate بيتغير فالصف بينتقل بين الشهور،
 * بخلاف الـ leads اللي تابها من createdAt وثابت.
 */
async function findTaskRows(doc, taskId) {
  const found = [];
  for (const sheet of doc.sheetsByIndex) {
    let rows = [];
    try {
      rows = await sheet.getRows();
    } catch (e) {
      continue;
    }
    for (const row of rows) {
      if (row.get("Record ID") === taskId) found.push({ sheet, row });
    }
  }
  return found;
}

// ==========================================
// الواجهة
// ==========================================

/**
 * بيزامن تاسك واحدة.
 * لو بقت مش شخصية (المدير غيّر المكلَّف)، الصف بيتمسح من الشيت.
 * بيفشل بهدوء — المزامنة مش حرجة والداتابيز هي مصدر الحقيقة.
 */
async function syncPersonalTask(task) {
  if (!SHEET_ID || !task?.id) return;

  return enqueue(async () => {
    try {
      const doc = await getDoc();
      const existing = await findTaskRows(doc, task.id);

      // اتمسحت أو بقت مش شخصية → نشيلها من الشيت
      if (!isPersonalTask(task) || task.isDeleted) {
        for (const { row } of existing) await row.delete();
        if (existing.length) {
          console.log(`[PersonalTasks] Removed ${task.id} (no longer personal)`);
        }
        return;
      }

      const title = tabForTask(task);
      const payload = buildRowPayload(task);

      // الصف موجود في التاب الصح؟ نحدّثه. في تاب تاني؟ نمسحه (الـ dueDate اتغير)
      let updated = false;
      for (const { sheet, row } of existing) {
        if (sheet.title === title && !updated) {
          row.assign(payload);
          await row.save();
          updated = true;
        } else {
          await row.delete();
        }
      }

      if (!updated) {
        const sheet = await getOrCreateTab(doc, title);
        await sheet.addRow(payload);
      }

      console.log(`[PersonalTasks] Synced "${task.title}" to [${title}]`);
    } catch (err) {
      cachedDoc = null;
      console.error("[PersonalTasks] Sync failed:", err.message);
    }
  });
}

/** بيشيل تاسك من الشيت بالـ id — للحذف */
async function removePersonalTask(taskId) {
  if (!SHEET_ID || !taskId) return;

  return enqueue(async () => {
    try {
      const doc = await getDoc();
      const existing = await findTaskRows(doc, taskId);
      for (const { row } of existing) await row.delete();
      if (existing.length) console.log(`[PersonalTasks] Deleted ${taskId}`);
    } catch (err) {
      cachedDoc = null;
      console.error("[PersonalTasks] Delete failed:", err.message);
    }
  });
}

/**
 * بيعيد بناء الشيت من الداتابيز — لأمر sync يدوي.
 * بياخد كل التاسكات الشخصية غير المحذوفة.
 */
async function rebuildPersonalTasksSheet(tasks) {
  if (!SHEET_ID) throw new Error("PERSONAL_TASKS_SHEETS_ID is not set");

  return enqueue(async () => {
    const doc = await getDoc();

    const groups = new Map();
    for (const task of tasks) {
      if (!isPersonalTask(task) || task.isDeleted) continue;
      const title = tabForTask(task);
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(buildRowPayload(task));
    }

    const stats = { tabs: 0, rows: 0, clearedTabs: 0 };
    const MONTH_TAB = /^[A-Z][a-z]+ \d{4}$/;

    for (const [title, rows] of groups) {
      const sheet = await getOrCreateTab(doc, title);
      await sheet.setHeaderRow(HEADERS);
      await sheet.clearRows().catch(() => {});
      if (rows.length) await sheet.addRows(rows);
      stats.tabs++;
      stats.rows += rows.length;
    }

    // تابات شهور مبقالهاش تاسكات — نفضّيها. التابات اليدوية بأي اسم تاني بتتجاهل
    for (const sheet of doc.sheetsByIndex) {
      if (groups.has(sheet.title) || !MONTH_TAB.test(sheet.title)) continue;
      await sheet.clearRows().catch(() => {});
      stats.clearedTabs++;
    }

    return stats;
  });
}

module.exports = {
  syncPersonalTask,
  removePersonalTask,
  rebuildPersonalTasksSheet,
  isPersonalTask,
};
