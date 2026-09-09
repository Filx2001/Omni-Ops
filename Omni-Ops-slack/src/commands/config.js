/**
 * /omni-config command: workspace control panel for Slack.
 * Usage: /omni-config [daily-report on|off | links]
 * Channel buttons assign the channel the command was run in.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");
const { sendDm } = require("../utils/slackDm");
const { isValidTimeZone } = require("../utils/slackDates");
const { testAiConnection, defaultModel, defaultBase } = require("../utils/aiGateway");
const TIMEZONE_OPTIONS = [
  { text: { type: "plain_text", text: "🌐 UTC (GMT)", emoji: true }, value: "UTC" },
  { text: { type: "plain_text", text: "🇬🇧 London", emoji: true }, value: "Europe/London" },
  { text: { type: "plain_text", text: "🇫 Paris", emoji: true }, value: "Europe/Paris" },
  { text: { type: "plain_text", text: "🇩🇪 Berlin", emoji: true }, value: "Europe/Berlin" },
  { text: { type: "plain_text", text: "🇹🇷 Istanbul", emoji: true }, value: "Europe/Istanbul" },
  { text: { type: "plain_text", text: "🇷 Moscow", emoji: true }, value: "Europe/Moscow" },
  { text: { type: "plain_text", text: "🇬 Cairo", emoji: true }, value: "Africa/Cairo" },
  { text: { type: "plain_text", text: "🇸🇦 Riyadh", emoji: true }, value: "Asia/Riyadh" },
  { text: { type: "plain_text", text: "🇶🇦 Qatar", emoji: true }, value: "Asia/Qatar" },
  { text: { type: "plain_text", text: "🇦🇪 Dubai", emoji: true }, value: "Asia/Dubai" },
  { text: { type: "plain_text", text: "🇮🇳 India", emoji: true }, value: "Asia/Kolkata" },
  { text: { type: "plain_text", text: "🇸 Singapore", emoji: true }, value: "Asia/Singapore" },
  { text: { type: "plain_text", text: "🇯🇵 Tokyo", emoji: true }, value: "Asia/Tokyo" },
  { text: { type: "plain_text", text: "🇺 New York", emoji: true }, value: "America/New_York" },
  {
    text: { type: "plain_text", text: "🇺🇸 Los Angeles", emoji: true },
    value: "America/Los_Angeles",
  },
  {
    text: { type: "plain_text", text: "⌨️ Other (type manually)", emoji: true },
    value: "__other__",
  },
];

const AI_PROVIDER_OPTIONS = [
  { text: { type: "plain_text", text: "Anthropic (Claude)", emoji: true }, value: "anthropic" },
  { text: { type: "plain_text", text: "OpenAI", emoji: true }, value: "openai" },
  { text: { type: "plain_text", text: "Google Gemini", emoji: true }, value: "gemini" },
  { text: { type: "plain_text", text: "DeepSeek", emoji: true }, value: "deepseek" },
  { text: { type: "plain_text", text: "Qwen", emoji: true }, value: "qwen" },
  {
    text: { type: "plain_text", text: "Custom (self-hosted / other)", emoji: true },
    value: "custom",
  },
  { text: { type: "plain_text", text: "❌ Remove AI config", emoji: true }, value: "__remove__" },
];

// action_id → workspace field for "assign current channel" buttons
const CHANNEL_FIELDS = {
  config_ch_leads: "leadsChannelId",
  config_ch_schedule: "scheduleChannelId",
  config_ch_billing: "billingChannelId",
  config_ch_logs: "logChannelId",
  config_ch_reminder: "reminderChannelId",
  config_ch_vacation: "vacationChannelId",
  config_ch_welcome: "welcomeChannelId",
  config_ch_intro: "introChannelId",
};

// callback_id → input block id, used for inline error reporting
const MODAL_ERROR_BLOCK = {
  config_modal_org: "org_block",
  config_modal_tz: "tz_block",
  config_modal_tz_custom: "tz_custom_block",
  config_modal_cur: "cur_block",
  config_modal_ai: "ai_key_block",
};

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

const ch = (id) => (id ? `<#${id}>` : "Not set");

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
        {
          type: "mrkdwn",
          text: `*🤖 AI*\n${workspace.aiApiKey ? "✅ Set" : "❌ Not set (optional)"}`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📢 Leads*\n${ch(workspace.leadsChannelId)}` },
        { type: "mrkdwn", text: `*📅 Schedule*\n${ch(workspace.scheduleChannelId)}` },
        { type: "mrkdwn", text: `*💰 Billing*\n${ch(workspace.billingChannelId)}` },
        { type: "mrkdwn", text: `*📝 Logs*\n${ch(workspace.logChannelId)}` },
        { type: "mrkdwn", text: `*🔔 Reminders*\n${ch(workspace.reminderChannelId)}` },
        { type: "mrkdwn", text: `*🏖️ Vacation*\n${ch(workspace.vacationChannelId)}` },
        { type: "mrkdwn", text: `*👋 Welcome*\n${ch(workspace.welcomeChannelId)}` },
        { type: "mrkdwn", text: `*🤝 Intro*\n${ch(workspace.introChannelId)}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "Slack has no role API: new members are auto-invited to the Welcome/Intro channels instead of auto-role. " +
            "Channel buttons assign the channel you run /omni-config in.",
        },
      ],
    },
  ];

  if (canManage) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🏢 Name", emoji: true },
          action_id: "config_set_org",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🌍 Timezone", emoji: true },
          action_id: "config_set_tz",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "💱 Currency", emoji: true },
          action_id: "config_set_cur",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🤖 AI", emoji: true },
          action_id: "config_set_ai",
        },
        ...(connectUrl
          ? [
              {
                type: "button",
                text: { type: "plain_text", text: "🔗 Google", emoji: true },
                url: connectUrl,
              },
            ]
          : []),
      ],
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📢 Leads", emoji: true },
          action_id: "config_ch_leads",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📅 Schedule", emoji: true },
          action_id: "config_ch_schedule",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "💰 Billing", emoji: true },
          action_id: "config_ch_billing",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📝 Logs", emoji: true },
          action_id: "config_ch_logs",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔔 Reminders", emoji: true },
          action_id: "config_ch_reminder",
        },
      ],
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🏖️ Vacation", emoji: true },
          action_id: "config_ch_vacation",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "👋 Welcome", emoji: true },
          action_id: "config_ch_welcome",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🤝 Intro", emoji: true },
          action_id: "config_ch_intro",
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

const orgModal = () => ({
  type: "modal",
  callback_id: "config_modal_org",
  title: { type: "plain_text", text: "Organization Name", emoji: true },
  submit: { type: "plain_text", text: "Save", emoji: true },
  close: { type: "plain_text", text: "Cancel", emoji: true },
  blocks: [
    {
      type: "input",
      block_id: "org_block",
      element: {
        type: "plain_text_input",
        action_id: "org",
        placeholder: { type: "plain_text", text: "e.g. Acme Academy" },
      },
      label: { type: "plain_text", text: "Name shown on invoices & reports", emoji: true },
    },
  ],
});

const tzModal = () => ({
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
});

const tzCustomModal = () => ({
  type: "modal",
  callback_id: "config_modal_tz_custom",
  title: { type: "plain_text", text: "Custom Timezone", emoji: true },
  submit: { type: "plain_text", text: "Save", emoji: true },
  close: { type: "plain_text", text: "Cancel", emoji: true },
  blocks: [
    {
      type: "input",
      block_id: "tz_custom_block",
      element: {
        type: "plain_text_input",
        action_id: "timezone",
        placeholder: { type: "plain_text", text: "e.g. Asia/Qatar, Europe/London" },
      },
      label: { type: "plain_text", text: "IANA timezone name", emoji: true },
    },
  ],
});

const curModal = () => ({
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
        placeholder: { type: "plain_text", text: "e.g. USD, EUR, GBP" },
      },
      label: { type: "plain_text", text: "Currency (3-letter code)", emoji: true },
    },
  ],
});

const aiModal = () => ({
  type: "modal",
  callback_id: "config_modal_ai",
  title: { type: "plain_text", text: "AI Connection", emoji: true },
  submit: { type: "plain_text", text: "Save", emoji: true },
  close: { type: "plain_text", text: "Cancel", emoji: true },
  blocks: [
    {
      type: "input",
      block_id: "ai_provider_block",
      element: {
        type: "static_select",
        action_id: "provider",
        placeholder: { type: "plain_text", text: "Pick a provider" },
        options: AI_PROVIDER_OPTIONS,
      },
      label: { type: "plain_text", text: "Provider", emoji: true },
    },
    {
      type: "input",
      block_id: "ai_key_block",
      element: {
        type: "plain_text_input",
        action_id: "key",
        placeholder: { type: "plain_text", text: "API key (stored encrypted)" },
      },
      label: { type: "plain_text", text: "API key", emoji: true },
      hint: {
        type: "plain_text",
        text: "Saved untested; the assistant validates it on first use.",
        emoji: true,
      },
    },
    {
      type: "input",
      block_id: "ai_model_block",
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "model",
        placeholder: {
          type: "plain_text",
          text: "e.g. claude-sonnet-4, gpt-4o (blank = provider default)",
        },
      },
      label: { type: "plain_text", text: "Model", emoji: true },
    },
    {
      type: "input",
      block_id: "ai_base_block",
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "base",
        placeholder: {
          type: "plain_text",
          text: "Required for Custom, optional override otherwise",
        },
      },
      label: { type: "plain_text", text: "Base URL", emoji: true },
    },
  ],
});

function buildLinksBlocks(data) {
  const line = (label, url) => (url ? `• <${url}|${label}>` : null);
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "🔗 Project Links", emoji: true } },
  ];
  const sheets = [
    line("Leads", data.sheets?.leads),
    line("Accounting", data.sheets?.accounting),
    line("Personal Tasks", data.sheets?.personalTasks),
  ].filter(Boolean);
  const calendars = [
    line("Main Calendar", data.calendars?.main),
    line("Personal Tasks Calendar", data.calendars?.personalTasks),
  ].filter(Boolean);
  const platforms = [
    line("Chatwoot — team inbox", data.platforms?.chatwoot),
    line("WhatsApp Manager", data.platforms?.whatsappManager),
    line("Meta Developers", data.platforms?.metaDevelopers),
  ].filter(Boolean);
  const api = [line("Server", data.api?.baseUrl), line("Health check", data.api?.health)].filter(
    Boolean
  );

  if (sheets.length)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📊 Google Sheets*\n${sheets.join("\n")}` },
    });
  if (calendars.length)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📅 Calendars*\n${calendars.join("\n")}` },
    });
  if (platforms.length)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🌐 Platforms*\n${platforms.join("\n")}` },
    });
  if (api.length)
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*⚙️ API*\n${api.join("\n")}` } });
  if (blocks.length === 1)
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No links available. Connect Google first via the control panel.",
      },
    });
  return blocks;
}

module.exports = {
  /** Routes /omni-config [subcommand]. */
  async handleConfigCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    const args = command.text.trim().split(/\s+/);
    const sub = args[0]?.toLowerCase();

    try {
      if (sub === "daily-report") {
        const enabled = args[1]?.toLowerCase() === "on";
        if (!["on", "off"].includes(args[1]?.toLowerCase())) {
          return say({
            text: "Usage",
            blocks: buildErrorBlock("Usage: `/omni-config daily-report on|off`"),
            response_type: "ephemeral",
          });
        }
        const me = await runWithTenant(workspaceId, () =>
          axios.get(`/employees/external/${command.user_id}`)
        ).catch(() => null);
        if (!me) {
          return say({
            text: "Not registered",
            blocks: buildErrorBlock(
              "Your account is not linked to an employee record. Run `/omni-employee register` first."
            ),
            response_type: "ephemeral",
          });
        }
        await runWithTenant(workspaceId, () =>
          axios.patch(`/employees/${me.data.id}`, { dailyReportEnabled: enabled })
        );
        return say({
          text: "Daily report updated",
          blocks: buildSuccessBlock(
            enabled ? "🌅 Daily morning brief enabled." : "🌙 Daily morning brief disabled."
          ),
          response_type: "ephemeral",
        });
      }

      if (sub === "links") {
        const res = await runWithTenant(workspaceId, () => axios.get(`/settings/links`));
        return say({
          text: "Project links",
          blocks: buildLinksBlocks(res.data || {}),
          response_type: "ephemeral",
        });
      }

      if (sub && sub !== "setup") {
        return say({
          text: "Usage",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "*Available subcommands:*\n" +
                  "• `/omni-config` — Open the control panel\n" +
                  "• `/omni-config daily-report on|off` — Your morning brief\n" +
                  "• `/omni-config links` — Connected platform links",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }

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

  /** Panel buttons: modals and current-channel assignments. */
  async handleConfigAction({ body, ack, respond, say, client }) {
    await ack();
    const workspaceId = body.team?.id;
    const slackUserId = body.user?.id;
    const channelId = body.channel?.id;
    const actionId = body.actions?.[0]?.action_id;

    try {
      const canManage = await canManageWorkspace(client, slackUserId, workspaceId);
      if (!canManage) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only the workspace owner or an Admin can change settings."),
          response_type: "ephemeral",
        });
      }

      const modals = {
        config_set_org: orgModal(),
        config_set_tz: tzModal(),
        config_set_cur: curModal(),
        config_set_ai: aiModal(),
      };
      if (modals[actionId]) {
        return client.views.open({ trigger_id: body.trigger_id, view: modals[actionId] });
      }

      const field = CHANNEL_FIELDS[actionId];
      if (field) {
        if (!channelId || channelId.startsWith("D")) {
          return say({
            text: "Run in a channel",
            blocks: buildErrorBlock(
              "Run `/omni-config` inside the channel you want to assign, then press the button again."
            ),
            response_type: "ephemeral",
          });
        }
        const updated = await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { [field]: channelId })
        );
        const connectUrl = `${await apiBaseUrl(workspaceId)}/google/connect?ws=${workspaceId}`;
        return respond({
          response_type: "ephemeral",
          replace_original: true,
          text: "Workspace configuration",
          blocks: await buildConfigPanel(updated.data, true, connectUrl),
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

  /** Modal submissions for org, timezone, currency and AI. */
  async handleConfigViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;
    const callbackId = view.callback_id;
    const errorBlockId = MODAL_ERROR_BLOCK[callbackId] || "org_block";

    try {
      if (
        callbackId === "config_modal_tz" &&
        view.state.values.tz_block?.timezone?.selected_option?.value === "__other__"
      ) {
        return ack({ response_action: "update", view: tzCustomModal() });
      }

      if (callbackId === "config_modal_org") {
        const org = view.state.values.org_block.org.value.trim();
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { organizationName: org })
        );
        await ack();
        return sendDm(client, userId, {
          text: `Organization name updated to ${org}`,
          blocks: buildSuccessBlock(`Organization name updated to *${org}*.`),
        });
      }

      if (callbackId === "config_modal_tz") {
        const tz = view.state.values.tz_block.timezone.selected_option.value;
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { timezone: tz })
        );
        await ack();
        return sendDm(client, userId, {
          text: `Timezone updated to ${tz}`,
          blocks: buildSuccessBlock(`Timezone updated to *${tz}*.`),
        });
      }

      if (callbackId === "config_modal_tz_custom") {
        const tz = view.state.values.tz_custom_block.timezone.value.trim();
        if (!isValidTimeZone(tz)) {
          return ack({
            response_action: "errors",
            errors: { tz_custom_block: `“${tz}” is not a valid IANA timezone (e.g. Asia/Qatar).` },
          });
        }
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { timezone: tz })
        );
        await ack();
        return sendDm(client, userId, {
          text: `Timezone updated to ${tz}`,
          blocks: buildSuccessBlock(`Timezone updated to *${tz}*.`),
        });
      }

      if (callbackId === "config_modal_cur") {
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
        return sendDm(client, userId, {
          text: `Currency updated to ${currency}`,
          blocks: buildSuccessBlock(`Currency updated to *${currency}*.`),
        });
      }

      if (callbackId === "config_modal_ai") {
        const provider = view.state.values.ai_provider_block.provider.selected_option.value;

        if (provider === "__remove__") {
          await runWithTenant(workspaceId, () =>
            axios.patch(`/workspaces/slack/${workspaceId}`, { aiApiKey: null })
          );
          await ack();
          return sendDm(client, userId, {
            text: "AI config removed",
            blocks: buildSuccessBlock("AI configuration removed for this workspace."),
          });
        }

        const key = view.state.values.ai_key_block.key.value.trim();
        const model = view.state.values.ai_model_block?.model?.value?.trim() || undefined;
        const base = view.state.values.ai_base_block?.base?.value?.trim() || undefined;
        if (provider === "custom" && !base) {
          return ack({
            response_action: "errors",
            errors: { ai_base_block: "Base URL is required for Custom providers." },
          });
        }
        const cfg = { provider, model, key, baseUrl: base };
        const test = await testAiConnection({
          provider,
          model: model || defaultModel(provider),
          apiKey: key,
          baseUrl: base || defaultBase(provider),
        });
        if (!test.ok) {
          return ack({ response_action: "errors", errors: { ai_key_block: test.message } });
        }
        await runWithTenant(workspaceId, () =>
          axios.patch(`/workspaces/slack/${workspaceId}`, { aiApiKey: JSON.stringify(cfg) })
        );
        await ack();
        return sendDm(client, userId, {
          text: "AI config saved",
          blocks: buildSuccessBlock(
            `AI configuration saved for provider *${provider}*. Stored encrypted, workspace-scoped.`
          ),
        });
      }

      await ack();
    } catch (error) {
      console.error("Config view submit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { [errorBlockId]: `Save failed: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
