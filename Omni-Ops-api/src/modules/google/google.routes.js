const router = require("express").Router();
const googleAuth = require("../../integrations/googleAuth");

// Browser lands here → redirect to Google consent screen
router.get("/connect", async (req, res) => {
  const url = googleAuth.buildConnectUrl(req.query.ws);
  if (!url) return res.status(501).send("Google OAuth is not configured on this deployment.");
  res.redirect(url);
});

// Google redirects back here after approval
router.get("/callback", async (req, res) => {
  try {
    const externalId = googleAuth.verifyState(req.query.state);
    if (!externalId) return res.status(403).send("Invalid state.");
    const email = await googleAuth.handleCallback(req.query.code, externalId);
    res.send(
      `<h1>✅ Google connected</h1><p><b>${email || ""}</b> — Sheets & Calendar are ready.<br>You can close this tab and return to Discord.</p>`
    );
  } catch (err) {
    console.error("[Google] callback error:", err.message);
    res.status(500).send("❌ Connection failed. Try again from Discord.");
  }
});

module.exports = router;
