require("dotenv").config();
const { App, FileInstallationStore } = require("@slack/bolt");
const installationStore = require("./utils/installationStore");
const { runWithTenant } = require("./utils/tenantContext");
const { getWorkspace } = require("./utils/workspace");

// Initialize Bolt App with Socket Mode and Custom Installation Store
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: "omni-ops-state-secret", // Random string for OAuth state
  scopes: ["chat:write", "commands", "app_mentions:read", "users:read"],
  installationStore,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// 🔥 Phase 0 Test: The Ping Command
app.command("/omni-ping", async ({ command, ack, say, client }) => {
  await ack();
  const teamId = command.team_id;

  // Set tenant context for any API calls
  await runWithTenant(teamId, async () => {
    const ws = await getWorkspace(teamId);
    await say(`🏓 Pong! Connected to workspace: *${ws.organizationName}* (ID: ${ws.id})`);
  });
});

(async () => {
  await app.start();
  console.log("⚡️ Omni-Ops Slack Bot is running in Socket Mode!");
})();
