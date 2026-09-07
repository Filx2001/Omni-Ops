const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");

const TIMEZONE_OPTIONS = [
  { text: { type: "plain_text", text: "🌐 UTC (GMT)" }, value: "UTC" },
  { text: { type: "plain_text", text: "🇬🇧 London" }, value: "Europe/London" },
  { text: { type: "plain_text", text: "🇫🇷 Paris" }, value: "Europe/Paris" },
  { text: { type: "plain_text", text: "🇩🇪 Berlin" }, value: "Europe/Berlin" },
  { text: { type: "plain_text", text: "🇹🇷 Istanbul" }, value: "Europe/Istanbul" },
  { text: { type: "plain_text", text: "🇷🇺 Moscow" }, value: "Europe/Moscow" },
  { text: { type: "plain_text", text: "🇪🇬 Cairo" }, value: "Africa/Cairo" },
  { text: { type: "plain_text", text: "🇸🇦 Riyadh" }, value: "Asia/Riyadh" },
  { text: { type: "plain_text", text: "🇶🇦 Qatar" }, value: "Asia/Qatar" },
  { text: { type: "plain_text", text: "🇦🇪 Dubai" }, value: "Asia/Dubai" },
  { text: { type: "plain_text", text: "🇮🇳 India" }, value: "Asia/Kolkata" },
  { text: { type: "plain_text", text: "🇸🇬 Singapore" }, value: "Asia/Singapore" },
  { text: { type: "plain_text", text: "🇯🇵 Tokyo" }, value: "Asia/Tokyo" },
  { text: { type: "plain_text", text: "🇺🇸 New York" }, value: "America/New_York" },
  { text: { type: "plain_text", text: "🇺🇸 Los Angeles" }, value: "America/Los_Angeles" },
];

async function buildConfigPanel(workspace, slackUserId) {
  const isOwner = workspace.slackBotUserId === slackUserId;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "⚙️ Omni-Ops Control Panel", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Organization:* ${workspace.organizationName || "—"}\n` +
          `*Timezone:* ${workspace.timezone || "UTC"}\n` +
          `*Currency:* ${workspace.currency || "USD"}\n` +
          `*Platform:* ${workspace.platform}`,
      },
    },
  ];

  if (isOwner) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: " Set Timezone", emoji: true },
          action_id: "config_set_tz",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "💱 Set Currency", emoji: true },
          action_id: "config_set_cur",
        },
      ],
    });
  }

  return blocks;
}

module.exports = {
  // Slash command handler
  async handleConfigCommand({ command, ack, say, client }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const slackUserId = command.user_id;

      const response = await runWithTenant(workspaceId, async () => {
        return axios.get(`/workspaces/slack/${workspaceId}`);
      });

      const workspace = response.data;
      const blocks = await buildConfigPanel(workspace, slackUserId);

      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Config command error:", error.message);
      const blocks = buildErrorBlock(`Failed to load config: ${error.message}`);
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    }
  },

  // Block action handler
  async handleConfigAction({ action, ack, say, client }) {
    await ack();

    const workspaceId = action.team.id;
    const slackUserId = action.user.id;

    try {
      if (action.action_id === "config_set_tz") {
        // Show timezone select modal
        await client.views.open({
          trigger_id: action.trigger_id,
          view: {
            type: "modal",
            callback_id: "config_modal_tz",
            title: { type: "plain_text", text: "Set Timezone", emoji: true },
            submit: { type: "plain_text", text: "Save", emoji: true },
            close: { type: "plain_text", text: "Cancel", emoji: true },
            blocks: [
              {
                type: "input",
                block_id: "tz_block",
                element: {
                  type: "static_select",
                  action_id: "timezone",
                  placeholder: { type: "plain_text", text: "Select timezone" },
                  options: TIMEZONE_OPTIONS,
                },
                label: { type: "plain_text", text: "Timezone", emoji: true },
              },
            ],
          },
        });
      } else if (action.action_id === "config_set_cur") {
        // Show currency input modal
        await client.views.open({
          trigger_id: action.trigger_id,
          view: {
            type: "modal",
            callback_id: "config_modal_cur",
            title: { type: "plain_text", text: "Set Currency", emoji: true },
            submit: { type: "plain_text", text: "Save", emoji: true },
            close: { type: "plain_text", text: "Cancel", emoji: true },
            blocks: [
              {
                type: "input",
                block_id: "cur_block",
                element: {
                  type: "plain_text_input",
                  action_id: "currency",
                  placeholder: { type: "plain_text", text: "e.g., USD, EUR, GBP" },
                },
                label: { type: "plain_text", text: "Currency (3-letter code)", emoji: true },
              },
            ],
          },
        });
      }
    } catch (error) {
      console.error("Config action error:", error.message);
      const blocks = buildErrorBlock(`Action failed: ${error.message}`);
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    }
  },

  // View submission handler
  async handleConfigViewSubmit({ view, ack, say, client }) {
    const workspaceId = view.team_id;
    const callbackId = view.callback_id;

    try {
      if (callbackId === "config_modal_tz") {
        const tz = view.state.values.tz_block.timezone.selected_option.value;

        await runWithTenant(workspaceId, async () => {
          await axios.patch(`/workspaces/slack/${workspaceId}`, { timezone: tz });
        });

        const blocks = buildSuccessBlock(`✅ Timezone updated to *${tz}*`);
        await say({
          text: "Omni-Ops Response", // ⚠️ Fallback added
          blocks,
          response_type: "ephemeral",
        });
      } else if (callbackId === "config_modal_cur") {
        const currency = view.state.values.cur_block.currency.value.trim().toUpperCase();

        if (!/^[A-Z]{3}$/.test(currency)) {
          const blocks = buildErrorBlock(" Invalid currency. Use 3-letter code (e.g., USD).");
          return say({ blocks, response_type: "ephemeral" });
        }

        await runWithTenant(workspaceId, async () => {
          await axios.patch(`/workspaces/slack/${workspaceId}`, { currency });
        });

        const blocks = buildSuccessBlock(`✅ Currency updated to *${currency}*`);
        await say({
          text: "Omni-Ops Response", // ⚠️ Fallback added
          blocks,
          response_type: "ephemeral",
        });
      }

      await ack();
    } catch (error) {
      console.error("Config view submit error:", error.message);
      const blocks = buildErrorBlock(`Failed to save: ${error.message}`);
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
      await ack();
    }
  },
};
