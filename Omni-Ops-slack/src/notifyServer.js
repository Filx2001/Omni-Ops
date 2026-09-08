const express = require("express");
const axios = require("./utils/axiosInstance");
const { runWithTenant } = require("./utils/tenantContext");

function startNotifyServer(client) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.headers["x-api-key"] !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });

  app.get("/health", (req, res) => res.json({ status: "ok", service: "slack-bot" }));

  app.post("/notify/new-lead", async (req, res) => {
    res.json({ ok: true });
    const workspaceId = req.body.workspaceId;
    if (!workspaceId) return;

    try {
      const wsRes = await runWithTenant(workspaceId, () =>
        axios.get(`/workspaces/slack/${workspaceId}`)
      );
      const channelId = wsRes.data?.leadsChannelId;
      if (!channelId) return;

      await client.chat.postMessage({
        channel: channelId,
        text: `New lead: ${req.body.name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*🟢 New WhatsApp Lead*\n` +
                `*👤 Name:* ${req.body.name || "Unknown"}\n` +
                `*📱 Phone:* ${req.body.phone || "N/A"}\n` +
                `*💬 Message:* ${req.body.message || "No message"}`,
            },
          },
        ],
      });
    } catch (error) {
      console.error("[Notify] Failed to post lead to Slack:", error.message);
    }
  });

  const port = process.env.NOTIFY_PORT || 3001;
  app.listen(port, "::", () => console.log(`[Notify] Slack internal server listening on ${port}`));
}

module.exports = { startNotifyServer };
