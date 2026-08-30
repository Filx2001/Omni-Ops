// Internal Express server so the API can notify the bot about events
// (e.g., new WhatsApp leads). Not exposed to the internet — only reachable
// via the internal network (e.g., Railway private networking).
const express = require("express");
const { notifyNewLead } = require("./utils/dmNotifier");

function startNotifyServer(client) {
  const app = express();
  app.use(express.json());

  // Shared secret with the API bot — no new env variable needed
  app.use((req, res, next) => {
    if (req.headers["x-api-key"] !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });

  app.get("/health", (req, res) => res.json({ status: "ok", service: "discord-bot" }));

  app.post("/notify/new-lead", async (req, res) => {
    // Reply immediately so the API isn't blocked; sending continues in the background
    res.json({ ok: true });
    try {
      // Pass the workspaceId (guildId) from the payload so the bot knows which
      // workspace's leads channel to post to (multi-tenant safe).
      await notifyNewLead(client, req.body, req.body.workspaceId || req.body.guildId);
    } catch (error) {
      console.error("[Notify] Failed to send new lead notification:", error.message);
    }
  });

  const port = process.env.NOTIFY_PORT || 3001;
  // "::" is important — internal networks (like Railway) often use IPv6
  app.listen(port, "::", () => console.log(`[Notify] Internal server listening on ${port}`));
}

module.exports = { startNotifyServer };
