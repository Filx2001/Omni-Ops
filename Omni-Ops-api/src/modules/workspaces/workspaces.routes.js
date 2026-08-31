const router = require("express").Router();
const svc = require("./workspaces.service");

// GET /workspaces — list all (used by the bot's cron engines)
router.get("/", async (req, res, next) => {
  try {
    res.json(await svc.list());
  } catch (err) {
    next(err);
  }
});

// GET /workspaces/discord/:workspaceId — 404 if not found (bot onboarding relies on this)
router.get("/discord/:workspaceId", async (req, res, next) => {
  try {
    const ws = await svc.getByExternal("DISCORD", req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    res.json(ws);
  } catch (err) {
    next(err);
  }
});

// POST /workspaces — create (idempotent) + seed default roles
router.post("/", async (req, res, next) => {
  try {
    const { platform, workspaceId, organizationName } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
    const ws = await svc.create({ platform, workspaceId, organizationName });
    res.status(201).json(ws);
  } catch (err) {
    next(err);
  }
});

// PATCH /workspaces/discord/:workspaceId — update settings / secrets (upsert)
router.patch("/discord/:workspaceId", async (req, res, next) => {
  try {
    res.json(await svc.updateByExternal("DISCORD", req.params.workspaceId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
