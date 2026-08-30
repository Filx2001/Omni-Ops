const express = require("express");
const router = express.Router();

const { getGuildSettings, updateGuildSettings } = require("./settings.service");

// لينكات الموارد الخارجية — بتتبني من متغيرات البيئة
// قراءة بس، ومفيش أسرار بتتعرض (الـ IDs مش سرية، الصلاحيات هي اللي بتحمي)
router.get("/links", async (req, res) => {
  try {
    const sheet = (id) => (id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null);
    const calendar = (id) =>
      id ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(id)}` : null;

    res.status(200).json({
      sheets: {
        leads: sheet(process.env.GOOGLE_SHEETS_ID),
        accounting: sheet(process.env.ACCOUNTING_SHEETS_ID),
        personalTasks: sheet(process.env.PERSONAL_TASKS_SHEETS_ID),
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:guildId", async (req, res) => {
  try {
    const settings = await getGuildSettings(req.params.guildId);

    res.json(settings);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:guildId", async (req, res) => {
  try {
    const settings = await updateGuildSettings(req.params.guildId, req.body);

    res.json(settings);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

module.exports = router;
