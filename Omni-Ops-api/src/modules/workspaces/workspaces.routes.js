const router = require("express").Router();
const svc = require("./workspaces.service");

router.get("/", async (req, res, next) => {
  try {
    res.json(await svc.list());
  } catch (err) {
    next(err);
  }
});

router.get("/discord/:workspaceId", async (req, res, next) => {
  try {
    const ws = await svc.getByExternal("DISCORD", req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    res.json(ws);
  } catch (err) {
    next(err);
  }
});

router.get("/slack/:workspaceId", async (req, res, next) => {
  try {
    const ws = await svc.getByExternal("SLACK", req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    res.json(ws);
  } catch (err) {
    next(err);
  }
});

// Internal route for the Slack bot to get the decrypted bot token
router.get("/slack/:workspaceId/credentials", async (req, res, next) => {
  try {
    const creds = await svc.getSlackCredentials(req.params.workspaceId);
    if (!creds) return res.status(404).json({ error: "Credentials not found" });
    res.json(creds);
  } catch (err) {
    next(err);
  }
});

// Internal route: decrypted AI config for the assistant (never exposed to panels)
router.get("/slack/:workspaceId/ai-config", async (req, res, next) => {
  try {
    res.json({ aiConfig: await svc.getAiConfigByExternal("SLACK", req.params.workspaceId) });
  } catch (err) {
    next(err);
  }
});

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

router.patch("/discord/:workspaceId", async (req, res, next) => {
  try {
    res.json(await svc.updateByExternal("DISCORD", req.params.workspaceId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.patch("/slack/:workspaceId", async (req, res, next) => {
  try {
    res.json(await svc.updateByExternal("SLACK", req.params.workspaceId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
