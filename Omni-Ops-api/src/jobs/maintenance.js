// Periodic maintenance for WhatsApp events: retry failed ones, clean up old ones.
const prisma = require("../prisma");
const { processStoredEvent } = require("../modules/crm/crm.service");

const RETENTION_DAYS = Number(process.env.WHATSAPP_EVENT_RETENTION_DAYS || 60);
const MAX_ATTEMPTS = 5;
const INTERVAL_MS = 60 * 60 * 1000; // Every hour

// Retries events that failed or got stuck (e.g., server crashed mid-processing)
async function retryFailedEvents() {
  // Wait 5 minutes so we don't interfere with real-time processing
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
    try {
      // processStoredEvent throws on failure and increments the attempt counter itself
      await processStoredEvent(event);
    } catch (err) {
      // Safeguard: if this is a legacy event from before multi-tenancy,
      // it won't have a workspaceId. Mark it as failed so it stops retrying.
      if (err.message && err.message.includes("No workspace resolved")) {
        await prisma.whatsAppEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", error: "Legacy event: missing workspaceId" },
        });
      }
    }
  }
}

// Deletes old processed events so the table doesn't grow infinitely
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
  // First run after 2 minutes to let the server stabilize
  setTimeout(runMaintenance, 2 * 60 * 1000);
  const timer = setInterval(runMaintenance, INTERVAL_MS);
  timer.unref?.(); // Doesn't prevent the process from exiting
  console.log("[Maintenance] Scheduler started");
}

module.exports = { startMaintenance, runMaintenance };
