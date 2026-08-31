const express = require("express");
const router = express.Router();
const { getDashboardStats } = require("./dashboard.service");

router.get("/", async (req, res) => {
  try {
    const stats = await getDashboardStats(req.workspace.id);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
