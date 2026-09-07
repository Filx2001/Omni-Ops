/**
 * /omni-config command: workspace settings panel for Slack.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");
const { sendDm } = require("../utils/slackDm");

const TIMEZONE_OPTIONS = [
  { text: { type: "plain_text", text: "🌐 UTC (GMT)", emoji: true }, value: "UTC" },
  { text: { type: "plain_text", text: "🇬 London", emoji: true }, value: "Europe/London" },
  { text: { type: "plain_text", text: "🇫 Paris", emoji: true }, value: "Europe/Paris" },
  { text: { type: "plain_text", text: "🇩🇪 Berlin", emoji: true }, value: "Europe/Berlin" },
  { text: { type: "plain_text", text: "🇹 Istanbul", emoji: true }, value: "Europe/Istanbul" },
  { text: { type: "plain_text", text: "🇷🇺 Moscow", emoji: true }, value: "Europe/Moscow" },
  { text: { type: "plain_text", text: "🇪🇬 Cairo", emoji: true }, value: "Africa/Cairo" },
  { text: { type: "plain_text", text: "🇸 Riyadh", emoji: true }, value: "Asia/Riyadh" },
  { text: { type: "plain_text", text: "🇶🇦 Qatar", emoji: true }, value: "Asia/Qatar" },
  { text: { type: "plain_text", text: "🇦🇪 Dubai", emoji: true }, value: "Asia/Dubai" },
  { text: { type: "plain_text", text: "🇮🇳 India", emoji: true }, value: "Asia/Kolkata" },
  { text: { type: "plain_text", text: "🇸🇬 Singapore", emoji: true }, value: "Asia/Singapore" },
  { text: { type: "plain_text", text: "🇯🇵 Tokyo", emoji: true }, value: "Asia/Tokyo" },
  { text: { type: "plain_text", text: "🇺🇸 New York", emoji: true }, value: "America/New_York" },
  {
    text: { type: "plain_text", text: "🇺🇸 Los Angeles", emoji: true },
    value: "America/Los_Angeles",
  },
];

/** Slack primary/secondary owner, or an employee with the Admin role. */
async function canManageWorkspace(client, slackUserId, workspaceId) {
  try {
    const info = await client.users.info({ user: slackUserId });
    if (info.user?.is_primary_owner || info.user?.is_owner) return true;
  } catch {}
  try {
    const res = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    return res.data?.role?.name === "Admin";
  } catch {
    return false;
  }
}

/** Public API base URL, self-reported by the API so no extra env var is needed. */
async function apiBaseUrl(workspaceId) {
  try {
    const res = await runWithTenant(workspaceId, () => axios.get(`/settings/links`));
    if (res.data?.api?.baseUrl) return String(res.data.api.baseUrl).replace(/\/$/, "");
  } catch {}
  return String(process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
}

async function buildConfigPanel(workspace, canManage, connectUrl) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "⚙️ Omni-Ops Control Panel", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*🏢 Organization*\n${workspace.organizationName || "—"}` },
        { type: "mrkdwn", text: `*🌍 Timezone*\n${workspace.timezone || "UTC"}` },
        { type: "mrkdwn", text: `*💱 Currency*\n${workspace.currency || "USD"}` },
        {
          type: "mrkdwn",
          text: `*🔗 Google*\n${workspace.googleEmail ? `✅ ${workspace.googleEmail}` : "❌ Not connected"}`,
        },
      ],
    },
  ];

  if (canManage) {
    const elements = [
      {
        type: "button",
        text: { type: "plain_text", text: "🌍 Set Timezone", emoji: true },
        action_id: "config_set_tz",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "💱 Set Currency", emoji: true },
        action_id: "config_set_cur",
      },
    ];
    if (connectUrl) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "🔗 Connect Google", emoji: true },
        url: connectUrl,
      });
    }
    blocks.push({ type: "actions", elements });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: connectUrl
            ? "Google connect opens in your browser; the confirmation tab means Sheets & Calendar are provisioned for this workspace."
            : "Google connect unavailable: the API did not report a public URL (check /settings/links or API_PUBLIC_URL).",
        },
      ],
    });
  } else {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Read-only view. Only the workspace owner or an Admin can change settings.",
        },
      ],
    });
  }

  return blocks;
}

module.exports = {
  /** /omni-config — shows the settings panel (ephemeral). */
  async handleConfigCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;

    try {
      const wsRes = await runWithTenant(workspaceId, () =>
        axios.get(`/workspaces/slack/${workspaceId}`)
      );
      const workspace = wsRes.data;
      const canManage = await canManageWorkspace(client, command.user_id, workspaceId);
      const connectUrl = canManage
        ? `${await apiBaseUrl(workspaceId)}/google/connect?ws=${workspaceId}`
        : null;

      await say({
        text: "Workspace configuration",
        blocks: await buildConfigPanel(workspace, canManage, connectUrl),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Config command error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(
          `Failed to load config: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** Panel buttons: timezone and currency modals. */
  async handleConfigAction({ body, ack, say, client }) {
    await ack();
    const workspaceId = body.team?.id;
    const slackUserId = body.user?.id;

    try {
      const canManage = await canManageWorkspace(client, slackUserId, workspaceId);
      if (!canManage) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only the workspace owner or an Admin can change settings."),
          response_type: "ephemeral",
        });
      }

      const actionId = body.actions?.[0]?.action_id;

      if (actionId === "config_set_tz") {
        await client.views.open({
          trigger_id: body.trigger_id,
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
      } else if (actionId === "config_set_cur") {
        await client.views.open({
          trigger_id: body.trigger_id,
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
      await say({
        text: "Error",
        blocks: buildErrorBlock(`Action failed: ${error.response?.data?.error || error.message}`),
        response_type: "ephemeral",
      });
    }
  },

  /** Modal submissions for timezone and currency. */
  async handleConfigViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;
    const callbackId = view.callback_id;
    const errorBlockId = callbackId === "config_modal_tz" ? "tz_block" : "cur_block";

    try {
      if (callbackId === "config_modal_tz") {
        const tz = view.state.values.tz_block.timezone.selected_option.value;
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { timezone: tz })
        );
        await ack();
        await sendDm(client, userId, {
          text: `Timezone updated to ${tz}`,
          blocks: buildSuccessBlock(`Timezone updated to *${tz}*.`),
        });
      } else if (callbackId === "config_modal_cur") {
        const currency = (view.state.values.cur_block.currency.value || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
          return ack({
            response_action: "errors",
            errors: { cur_block: "Use a 3-letter code like USD or EUR." },
          });
        }
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { currency })
        );
        await ack();
        await sendDm(client, userId, {
          text: `Currency updated to ${currency}`,
          blocks: buildSuccessBlock(`Currency updated to *${currency}*.`),
        });
      } else {
        await ack();
      }
    } catch (error) {
      console.error("Config view submit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { [errorBlockId]: `Save failed: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
