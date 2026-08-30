// صيانة دورية لأحداث الواتساب: إعادة معالجة الفاشل، وتنضيف القديم

const prisma = require("../prisma");
const { processStoredEvent } = require("../modules/crm/crm.service");

const RETENTION_DAYS = Number(process.env.WHATSAPP_EVENT_RETENTION_DAYS || 60);
const MAX_ATTEMPTS = 5;
const INTERVAL_MS = 60 * 60 * 1000; // كل ساعة

/** بيعيد معالجة الأحداث اللي فشلت أو علقت (مثلاً السيرفر وقع في نص المعالجة) */
async function retryFailedEvents() {
  // بنستنى 5 دقايق عشان منزاحمش المعالجة اللحظية
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);

  const stuck = await prisma.whatsAppEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      receivedAt: { lt: cutoff },
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });

  if (stuck.length === 0) return;
  console.log(`[Maintenance] Retrying ${stuck.length} stuck event(s)`);

  for (const event of stuck) {
    // processStoredEvent بيرمي عند الفشل وبيزوّد العداد لوحده
    await processStoredEvent(event).catch(() => {});
  }
}

/** بيمسح الأحداث المعالجة القديمة عشان الجدول ميكبرش بلا نهاية */
async function cleanupOldEvents() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await prisma.whatsAppEvent.deleteMany({
    where: { status: "PROCESSED", processedAt: { lt: cutoff } },
  });

  if (count > 0) console.log(`[Maintenance] Deleted ${count} old event(s)`);
}

async function runMaintenance() {
  try {
    await retryFailedEvents();
    await cleanupOldEvents();
  } catch (error) {
    console.error("[Maintenance] Run failed:", error.message);
  }
}

function startMaintenance() {
  // أول تشغيل بعد دقيقتين عشان السيرفر يستقر
  setTimeout(runMaintenance, 2 * 60 * 1000);
  const timer = setInterval(runMaintenance, INTERVAL_MS);
  timer.unref?.(); // ميمنعش البروسيس من الخروج
  console.log("[Maintenance] Scheduler started");
}

module.exports = { startMaintenance, runMaintenance };
