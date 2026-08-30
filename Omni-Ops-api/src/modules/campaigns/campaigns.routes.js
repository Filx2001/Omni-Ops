const express = require("express");
const router = express.Router();
const {
  getAudienceStats,
  createCampaign,
  startCampaign,
  stopCampaign,
  getCampaignProgress,
  getCampaignInfo,
  getCampaignRecipients,
  listCampaigns,
  findCampaigns,
} = require("./campaigns.service");
const { getTemplates } = require("../../utils/whatsapp");

// قوالب ميتا المعتمدة — بتتقرا مباشرة، مفيش أسماء مكتوبة في الكود
router.get("/templates", async (req, res) => {
  try {
    const templates = await getTemplates();
    res.status(200).json(templates);
  } catch (error) {
    console.error("[Campaign] Templates fetch failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// إحصائيات قاعدة العملاء — للاستكشاف قبل الإنشاء
router.get("/audience", async (req, res) => {
  try {
    const stats = await getAudienceStats();
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// قايمة الحملات
router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    res.status(200).json(await listCampaigns(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// بحث للـ autocomplete
router.get("/search", async (req, res) => {
  try {
    const statuses = req.query.status ? String(req.query.status).split(",") : null;
    res.status(200).json(await findCampaigns(statuses));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// إنشاء حملة (DRAFT) — بيرجع المعاينة والقمع
router.post("/", async (req, res) => {
  try {
    const result = await createCampaign(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error("[Campaign] Create failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    res.status(200).json(await getCampaignInfo(req.params.id));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// قايمة المستقبلين بالأسماء والأرقام — دي اللي بتتراجع قبل التأكيد
router.get("/:id/recipients", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : null;
    const status = req.query.status ? String(req.query.status) : null;
    res.status(200).json(await getCampaignRecipients(req.params.id, { limit, status }));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.get("/:id/progress", async (req, res) => {
  try {
    res.status(200).json(await getCampaignProgress(req.params.id));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.post("/:id/start", async (req, res) => {
  try {
    await startCampaign(req.params.id);
    res.status(200).json(await getCampaignProgress(req.params.id));
  } catch (error) {
    console.error("[Campaign] Start failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post("/:id/stop", async (req, res) => {
  try {
    await stopCampaign(req.params.id);
    res.status(200).json(await getCampaignProgress(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
