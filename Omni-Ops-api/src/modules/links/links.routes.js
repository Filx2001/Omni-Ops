const express = require("express");
const router = express.Router();

// Read-only utility route to expose external integration links to the bot
router.get("/", (req, res) => {
  const sheet = (id) => (id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null);
  const calendar = (id) =>
    id ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(id)}` : null;

  res.json({
    sheets: {
      leads: sheet(process.env.GOOGLE_SHEETS_ID),
      accounting: sheet(process.env.ACCOUNTING_SHEETS_ID),
      personalTasks: sheet(process.env.PERSONAL_TASKS_SHEET_ID),
    },
    calendars: {
      main: calendar(process.env.GOOGLE_CALENDAR_ID),
      personalTasks: calendar(process.env.PERSONAL_TASKS_CALENDAR_ID),
    },
    platforms: {
      chatwoot: process.env.CHATWOOT_BASE_URL || "https://app.chatwoot.com",
      whatsappManager: "https://business.facebook.com/wa/manage/",
      metaDevelopers: "https://developers.facebook.com/apps",
    },
    api: {
      baseUrl: process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null,
      health: process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`
        : null,
    },
  });
});

module.exports = router;
