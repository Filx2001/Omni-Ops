require("dotenv").config();
const { App } = require("@slack/bolt");
const axios = require("./utils/axiosInstance");
const { runWithTenant } = require("./utils/tenantContext");
const installationStore = require("./utils/installationStore");

// 🔥 Phase 2 Imports
const configCmd = require("./commands/config");
const employeeCmd = require("./commands/employee");
const teamJoinEvent = require("./events/teamJoin");

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

// ==========================================
// 🔥 Phase 0: Test Command
// ==========================================
app.command("/omni-ping", async ({ command, ack, say }) => {
  await ack();
  await runWithTenant(command.team_id, async () => {
    const { getWorkspace } = require("./utils/workspace");
    const ws = await getWorkspace(command.team_id);
    await say(`🏓 Pong! Connected to *${ws.organizationName}* _(platform: ${ws.platform})_`);
  });
});

// ==========================================
// 🔥 Phase 2: Config Commands & Actions
// ==========================================
app.command("/omni-config", configCmd.handleConfigCommand);
app.action("config_set_tz", configCmd.handleConfigAction);
app.action("config_set_cur", configCmd.handleConfigAction);
app.view("config_modal_tz", configCmd.handleConfigViewSubmit);
app.view("config_modal_cur", configCmd.handleConfigViewSubmit);

// ==========================================
// 🔥 Phase 2: Employee Commands
// ==========================================
// Slack passes raw text, so we manually parse subcommands here
app.command("/omni-employee", async ({ command, ack, say, client }) => {
  await ack();
  const args = command.text.trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === "link") {
    const email = args.slice(1).join(" ").trim();
    command.text = email; // Override to match the handler's expectation
    await employeeCmd.handleEmployeeLink({ command, ack, say, client });
  } else if (subcommand === "register") {
    await employeeCmd.handleEmployeeRegister({ command, ack, say, client });
  } else if (subcommand === "info") {
    await employeeCmd.handleEmployeeInfo({ command, ack, say });
  } else {
    await say({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "❌ Unknown subcommand. Use:\n" +
              "• `/omni-employee link <email>`\n" +
              "• `/omni-employee register`\n" +
              "• `/omni-employee info`",
          },
        },
      ],
      response_type: "ephemeral",
    });
  }
});

// ==========================================
// 🔥 Phase 2: Events
// ==========================================
app.event("team_join", teamJoinEvent.handleTeamJoin);

// ==========================================
// 🔥 Startup & Self-Registration
// ==========================================
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
