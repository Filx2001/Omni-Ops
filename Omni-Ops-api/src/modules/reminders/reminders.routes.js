const express = require("express");

const router = express.Router();

const {
  getPendingReminders,
  markRemindersSent,
} = require("../services/reminders/reminders.service");

/**
 * GET /reminders/pending
 *
 * Called by the bot scheduler.
 * Must be mounted inside the same protected router as /tasks,
 * where req.workspace is already injected.
 */
router.get("/pending", async (req, res) => {
  try {
    if (!req.workspace) {
      return res.status(400).json({
        error: "Workspace context is required.",
      });
    }

    const data = await getPendingReminders(req.workspace);

    return res.json(data);
  } catch (error) {
    console.error("[Reminders] Pending fetch failed:", error.message);
    return res.status(500).json({
      error: "Failed to fetch pending reminders.",
    });
  }
});

/**
 * POST /reminders/mark-sent
 *
 * Body:
 * {
 *   taskIds: [],
 *   appointmentIds: [],
 *   eventIds: []
 * }
 */
router.post("/mark-sent", async (req, res) => {
  try {
    if (!req.workspace) {
      return res.status(400).json({
        error: "Workspace context is required.",
      });
    }

    const result = await markRemindersSent(req.workspace, req.body || {});

    return res.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("[Reminders] Mark sent failed:", error.message);
    return res.status(500).json({
      error: "Failed to mark reminders as sent.",
    });
  }
});

module.exports = router;
