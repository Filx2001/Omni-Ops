require("dotenv").config();
const { App } = require("@slack/bolt");
const axios = require("./utils/axiosInstance");
const { runWithTenant } = require("./utils/tenantContext");
const installationStore = require("./utils/installationStore");

const SCOPES = [
  "app_mentions:read",
  "channels:join",
  "channels:manage",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "commands",
  "im:history",
  "im:write",
  "reactions:write",
  "team:read",
  "users:read",
  "users:read.email",
];

// Mode 1 (single workspace): SLACK_BOT_TOKEN set → dashboard-installed bot
// Mode 2 (multi-tenant SaaS): no SLACK_BOT_TOKEN → full OAuth install flow
const useOAuth = !process.env.SLACK_BOT_TOKEN;

const appOptions = {
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
};

if (useOAuth) {
  appOptions.clientId = process.env.SLACK_CLIENT_ID;
  appOptions.clientSecret = process.env.SLACK_CLIENT_SECRET;
  appOptions.stateSecret = process.env.SLACK_STATE_SECRET || "omni-ops-open-source-state";
  appOptions.scopes = SCOPES;
  appOptions.installationStore = installationStore;
} else {
  appOptions.token = process.env.SLACK_BOT_TOKEN;
}

const app = new App(appOptions);

// 🔥 Phase 0 test command
app.command("/omni-ping", async ({ command, ack, say }) => {
  await ack();
  await runWithTenant(command.team_id, async () => {
    const { getWorkspace } = require("./utils/workspace");
    const ws = await getWorkspace(command.team_id);
    await say(`🏓 Pong! Connected to *${ws.organizationName}* _(platform: ${ws.platform})_`);
  });
});

(async () => {
  // Single-token mode: self-register this installation with the API on startup
  if (!useOAuth) {
    try {
      const auth = await app.client.auth.test();
      await runWithTenant(auth.team_id, async () => {
        await axios
          .post("/workspaces", {
            platform: "SLACK",
            workspaceId: auth.team_id,
            organizationName: auth.team?.name || "Slack Workspace",
          })
          .catch(() => {}); // ignore if it already exists
        await axios.patch(`/workspaces/slack/${auth.team_id}`, {
          slackBotUserId: auth.user_id,
        });
      });
      console.log(`✅ Registered Slack workspace ${auth.team_id} with the API`);
    } catch (err) {
      console.error("⚠️ Could not self-register workspace:", err.message);
    }
  }

  await app.start();
  console.log("⚡ Omni-Ops Slack bot is running (Socket Mode)!");
})();
