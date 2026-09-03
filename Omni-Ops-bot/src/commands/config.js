const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const axios = require("../utils/axiosInstance");
const { getWorkspace, updateWorkspace } = require("../utils/workspace");
const EMBED_COLORS = require("../utils/embedColors");
const { isValidTimeZone } = require("../utils/dateParser");
const { PROVIDERS, encodeAiConfig, testAiConnection } = require("../utils/aiGateway");

const TIMEZONE_OPTIONS = [
  { label: "🌐 UTC (GMT)", value: "UTC" },
  { label: "🇬 London", value: "Europe/London" },
  { label: "🇫 Paris", value: "Europe/Paris" },
  { label: "🇩🇪 Berlin", value: "Europe/Berlin" },
  { label: "🇹🇷 Istanbul", value: "Europe/Istanbul" },
  { label: "🇷🇺 Moscow", value: "Europe/Moscow" },
  { label: "🇪 Cairo", value: "Africa/Cairo" },
  { label: "🇲 Casablanca", value: "Africa/Casablanca" },
  { label: "🇳🇬 Lagos", value: "Africa/Lagos" },
  { label: "🇿🇦 Johannesburg", value: "Africa/Johannesburg" },
  { label: "🇸🇦 Riyadh", value: "Asia/Riyadh" },
  { label: "🇶🇦 Qatar", value: "Asia/Qatar" },
  { label: "🇦🇪 Dubai", value: "Asia/Dubai" },
  { label: "🇯🇴 Amman", value: "Asia/Amman" },
  { label: "🇱 Beirut", value: "Asia/Beirut" },
  { label: "🇮🇶 Baghdad", value: "Asia/Baghdad" },
  { label: "🇮🇷 Tehran", value: "Asia/Tehran" },
  { label: "🇵🇰 Karachi", value: "Asia/Karachi" },
  { label: "🇮 India", value: "Asia/Kolkata" },
  { label: "🇸🇬 Singapore", value: "Asia/Singapore" },
  { label: "🇯 Tokyo", value: "Asia/Tokyo" },
  { label: "🇺🇸 New York", value: "America/New_York" },
  { label: "🇺🇸 Los Angeles", value: "America/Los_Angeles" },
  { label: "🇧🇷 São Paulo", value: "America/Sao_Paulo" },
  { label: "⌨️ Other (type manually)", value: "__other__" },
];

// The server owner IS the system owner — always derived live from Discord,
// so ownership transfers automatically with the server.
const isOwner = (i) => i.user.id === i.guild.ownerId;
const btn = (id, label, style) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

// Shows provider + model in the panel (parses the JSON config stored in aiApiKey)
function aiLabel(ws) {
  if (!ws?.hasAiKey && !ws?.aiApiKey) return "❌ Not set (optional)";
  try {
    const cfg = JSON.parse(ws.aiApiKey);
    if (cfg?.provider)
      return `✅ ${PROVIDERS[cfg.provider]?.label || cfg.provider} · ${cfg.model || "default"}`;
  } catch {}
  return "✅ Set (legacy key)";
}

async function buildPanel(interaction, ws) {
  const ch = (id) => (id ? `<#${id}>` : "Not set");
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle("⚙️ Omni-Ops Control Panel")
    .setDescription(
      `**System Owner:** <@${interaction.guild.ownerId}>\n` +
        `No files, no code — tap a button to change a setting.\n` +
        `📢 Channel buttons assign **the channel you ran /config setup in**.`
    )
    .addFields(
      { name: "🏢 Organization", value: ws.organizationName || "—", inline: true },
      { name: "🌍 Timezone", value: ws.timezone || "UTC", inline: true },
      { name: "💱 Currency", value: ws.currency || "USD", inline: true },
      { name: "🤖 AI", value: aiLabel(ws), inline: true },
      {
        name: "🔗 Google",
        value: ws.googleEmail ? `✅ ${ws.googleEmail}` : "❌ Not connected",
        inline: true,
      },
      { name: "📢 Leads", value: ch(ws.leadsChannelId), inline: true },
      { name: "📅 Schedule", value: ch(ws.scheduleChannelId), inline: true },
      { name: "💰 Billing", value: ch(ws.billingChannelId), inline: true },
      { name: "📝 Logs", value: ch(ws.logChannelId), inline: true },
      { name: "🔔 Reminders", value: ch(ws.reminderChannelId), inline: true },
      { name: "🏖️ Vacation", value: ch(ws.vacationChannelId), inline: true },
      { name: "👋 Welcome", value: ch(ws.welcomeChannelId), inline: true },
      { name: "🤝 Intro", value: ch(ws.introChannelId), inline: true },
      {
        name: "🔰 Auto Role",
        value: ws.autoRoleId ? `<@&${ws.autoRoleId}>` : "Not set (use /config auto-role)",
        inline: true,
      }
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    btn("cfg_org", "🏢 Name", ButtonStyle.Secondary),
    btn("cfg_tz", "🌍 Timezone", ButtonStyle.Secondary),
    btn("cfg_cur", "💱 Currency", ButtonStyle.Secondary),
    btn("cfg_ai", "🤖 AI", ButtonStyle.Secondary),
    btn("cfg_google", "🔗 Google", ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn("cfg_ch_leads", "📢 Leads", ButtonStyle.Primary),
    btn("cfg_ch_schedule", "📅 Schedule", ButtonStyle.Primary),
    btn("cfg_ch_billing", "💰 Billing", ButtonStyle.Primary),
    btn("cfg_ch_logs", "📝 Logs", ButtonStyle.Primary),
    btn("cfg_ch_reminder", "🔔 Reminders", ButtonStyle.Primary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    btn("cfg_ch_vacation", "🏖️ Vacation", ButtonStyle.Primary),
    btn("cfg_ch_welcome", "👋 Welcome", ButtonStyle.Primary),
    btn("cfg_ch_intro", "🤝 Intro", ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

const modal = (id, title, fieldId, label, placeholder) => {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  const input = new TextInputBuilder()
    .setCustomId(fieldId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholder)
    .setRequired(true);
  m.addComponents(new ActionRowBuilder().addComponents(input));
  return m;
};

const successEmbed = (title, description) =>
  new EmbedBuilder()
    .setColor(EMBED_COLORS.SUCCESS)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

// Key (+ optional base URL / custom model) modal for the AI connection
async function showAiKeyModal(interaction, provider, model) {
  const m = new ModalBuilder()
    .setCustomId(`cfg_modal_ai_key:${provider}:${model}`)
    .setTitle("🤖 AI Connection");
  if (model === "__custom__") {
    m.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("model")
          .setLabel("Model name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. llama-3.3-70b, grok-2, mistral-large…")
          .setRequired(true)
      )
    );
  }
  m.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("key")
        .setLabel("API key (stored encrypted)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("base")
        .setLabel(provider === "custom" ? "Base URL (required)" : "Base URL (optional override)")
        .setStyle(TextInputStyle.Short)
        .setRequired(provider === "custom")
        .setPlaceholder("e.g. https://api.openai.com/v1")
    )
  );
  return interaction.showModal(m);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Workspace control panel & settings")
    .addSubcommand((sub) =>
      sub.setName("setup").setDescription("Open the interactive control panel (server owner only)")
    )
    .addSubcommand((sub) => sub.setName("view").setDescription("View current workspace settings"))
    .addSubcommand((sub) =>
      sub
        .setName("auto-role")
        .setDescription("Set the role given automatically to new members (owner only)")
        .addRoleOption((option) => option.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("daily-report")
        .setDescription("Turn YOUR daily morning brief on or off")
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Enable or disable the daily report for you")
            .setRequired(true)
            .addChoices({ name: "On 🟢", value: "on" }, { name: "Off 🔴", value: "off" })
        )
    )
    .addSubcommand((sub) =>
      sub.setName("links").setDescription("Show all connected platform links")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // ================= SETUP (interactive panel) =================
    if (subcommand === "setup") {
      if (!isOwner(interaction)) {
        return interaction.reply({
          content: "❌ Only the **server owner** can open the control panel.",
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ws = await getWorkspace(interaction.guildId, {
        create: true,
        guildName: interaction.guild.name,
      });
      return interaction.editReply(await buildPanel(interaction, ws));
    }

    // ================= VIEW (read-only, no buttons) =================
    if (subcommand === "view") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ws = await getWorkspace(interaction.guildId, {
        create: true,
        guildName: interaction.guild.name,
      });
      const panel = await buildPanel(interaction, ws);
      return interaction.editReply({ embeds: panel.embeds });
    }

    // ================= AUTO ROLE =================
    if (subcommand === "auto-role") {
      if (!isOwner(interaction)) {
        return interaction.reply({
          content: "❌ Only the **server owner** can change settings.",
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const role = interaction.options.getRole("role");
      await updateWorkspace(interaction.guildId, { autoRoleId: role.id });
      return interaction.editReply({
        embeds: [
          successEmbed("🔰 Auto Role Updated", `New members will automatically receive ${role}.`),
        ],
      });
    }

    // ================= DAILY REPORT =================
    if (subcommand === "daily-report") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const enabled = interaction.options.getString("status") === "on";
      let me;
      try {
        me = (await axios.get(`/employees/external/${interaction.user.id}`)).data;
      } catch {}
      if (!me) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLORS.DELETE)
              .setTitle("❌ Not Linked")
              .setDescription(
                "Your account is not linked to an employee record, so the daily report can't be toggled for you."
              ),
          ],
        });
      }
      await axios.patch(`/employees/${me.id}`, {
        dailyReportEnabled: enabled,
      });
      return interaction.editReply({
        embeds: [
          successEmbed(
            enabled ? "🌅 Daily Report Enabled" : "🌙 Daily Report Disabled",
            enabled
              ? "You will receive the morning brief every day in your DMs."
              : "You will no longer receive the daily morning brief. Turn it back on anytime with /config daily-report."
          ),
        ],
      });
    }

    // ================= LINKS =================
    if (subcommand === "links") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { data } = await axios.get(`/settings/links`);
        if (!data?.sheets) {
          return interaction.editReply(
            "❌ Couldn't load the links. The API may not have the latest version deployed."
          );
        }
        const line = (label, url) => (url ? `[${label}](${url})` : null);
        const sheets = [
          line("Leads", data.sheets.leads),
          line("Accounting", data.sheets.accounting),
          line("Personal Tasks", data.sheets.personalTasks),
        ].filter(Boolean);
        const calendars = [
          line("Main Calendar", data.calendars.main),
          line("Personal Tasks Calendar", data.calendars.personalTasks),
        ].filter(Boolean);
        const platforms = [
          line("Chatwoot — team inbox", data.platforms.chatwoot),
          line("WhatsApp Manager", data.platforms.whatsappManager),
          line("Meta Developers", data.platforms.metaDevelopers),
        ].filter(Boolean);
        const api = [
          line("Server", data.api.baseUrl),
          line("Health check", data.api.health),
        ].filter(Boolean);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle("🔗 Project Links")
          .setDescription("Everything this workspace is connected to.")
          .setFooter({ text: "Access to these links is controlled by each platform separately" })
          .setTimestamp();
        if (sheets.length) embed.addFields({ name: "📊 Google Sheets", value: sheets.join("\n") });
        if (calendars.length)
          embed.addFields({ name: "📅 Calendars", value: calendars.join("\n") });
        if (platforms.length)
          embed.addFields({ name: "🌐 Platforms", value: platforms.join("\n") });
        if (api.length) embed.addFields({ name: "⚙️ API", value: api.join("\n") });
        return interaction.editReply({ embeds: [embed] });
      } catch {
        return interaction.editReply("❌ Couldn't load the links right now.");
      }
    }
  },

  // ================= CONTROL PANEL buttons, selects & modals =================
  async handleComponent(interaction) {
    if (!isOwner(interaction)) {
      return interaction
        .reply({
          content: "❌ Only the server owner can change settings.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // ---- Buttons ----
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === "cfg_org")
        return interaction.showModal(
          modal(
            "cfg_modal_org",
            "Organization Name",
            "org",
            "Name shown on invoices & reports",
            "e.g. Acme Academy"
          )
        );
      if (id === "cfg_tz") {
        const ws = await getWorkspace(interaction.guildId, {
          create: true,
          guildName: interaction.guild.name,
        });
        const panel = await buildPanel(interaction, ws);
        const select = new StringSelectMenuBuilder()
          .setCustomId("cfg_select_tz")
          .setPlaceholder("🌍 Pick your timezone…")
          .addOptions(...TIMEZONE_OPTIONS);
        panel.components.push(new ActionRowBuilder().addComponents(select));
        return interaction.update(panel);
      }
      if (id === "cfg_google") {
        const url = `${process.env.API_PUBLIC_URL}/google/connect?ws=${interaction.guildId}`;
        return interaction.reply({
          content:
            "🔗 Connect your Google account — the bot will auto-create your Sheets & Calendar:",
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setLabel("Connect Google").setStyle(ButtonStyle.Link).setURL(url)
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (id === "cfg_cur")
        return interaction.showModal(
          modal("cfg_modal_cur", "Currency", "cur", "3-letter currency code", "e.g. USD, EUR, GBP")
        );
      if (id === "cfg_ai") {
        const ws = await getWorkspace(interaction.guildId, {
          create: true,
          guildName: interaction.guild.name,
        });
        const panel = await buildPanel(interaction, ws);
        const select = new StringSelectMenuBuilder()
          .setCustomId("cfg_select_ai_provider")
          .setPlaceholder("🤖 Pick an AI provider…")
          .addOptions(
            ...Object.entries(PROVIDERS).map(([value, p]) => ({ label: p.label, value })),
            { label: "❌ Remove AI config", value: "__remove__" }
          );
        panel.components.push(new ActionRowBuilder().addComponents(select));
        return interaction.update(panel);
      }
      const channelMap = {
        cfg_ch_leads: "leadsChannelId",
        cfg_ch_schedule: "scheduleChannelId",
        cfg_ch_billing: "billingChannelId",
        cfg_ch_logs: "logChannelId",
        cfg_ch_reminder: "reminderChannelId",
        cfg_ch_vacation: "vacationChannelId",
        cfg_ch_welcome: "welcomeChannelId",
        cfg_ch_intro: "introChannelId",
      };
      if (channelMap[id]) {
        const ws = await updateWorkspace(interaction.guildId, {
          [channelMap[id]]: interaction.channelId,
        });
        return interaction.update(await buildPanel(interaction, ws));
      }
      return;
    }

    // ---- Timezone dropdown ----
    if (interaction.isStringSelectMenu() && interaction.customId === "cfg_select_tz") {
      const value = interaction.values[0];
      if (value === "__other__") {
        return interaction.showModal(
          modal(
            "cfg_modal_tz",
            "Timezone",
            "tz",
            "IANA timezone name",
            "e.g. Asia/Qatar, Europe/London"
          )
        );
      }
      const ws = await updateWorkspace(interaction.guildId, { timezone: value });
      return interaction.update(await buildPanel(interaction, ws));
    }

    // ---- AI provider dropdown ----
    if (interaction.isStringSelectMenu() && interaction.customId === "cfg_select_ai_provider") {
      const provider = interaction.values[0];
      if (provider === "__remove__") {
        const ws = await updateWorkspace(interaction.guildId, { aiApiKey: null });
        return interaction.update(await buildPanel(interaction, ws));
      }
      const ws = await getWorkspace(interaction.guildId, {
        create: true,
        guildName: interaction.guild.name,
      });
      const panel = await buildPanel(interaction, ws);
      const models = PROVIDERS[provider]?.models || [];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`cfg_select_ai_model:${provider}`)
        .setPlaceholder("🧠 Pick a model…")
        .addOptions(...models.slice(0, 24).map((m) => ({ label: m, value: m })), {
          label: "⌨️ Custom model (type manually)",
          value: "__custom__",
        });
      panel.components.push(new ActionRowBuilder().addComponents(select));
      return interaction.update(panel);
    }

    // ---- AI model dropdown → key modal ----
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("cfg_select_ai_model:")
    ) {
      const provider = interaction.customId.split(":")[1];
      return showAiKeyModal(interaction, provider, interaction.values[0]);
    }

    // ---- Modals ----
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      // AI connection modal: test FIRST, save only if the key works
      if (id.startsWith("cfg_modal_ai_key:")) {
        const parts = id.split(":");
        const provider = parts[1];
        const modelSel = parts[2];
        const model =
          modelSel === "__custom__"
            ? interaction.fields.getTextInputValue("model").trim()
            : modelSel;
        const key = interaction.fields.getTextInputValue("key").trim();
        const base = interaction.fields.getTextInputValue("base").trim();
        const cfg = { provider, model, key, baseUrl: base || undefined };

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const test = await testAiConnection(cfg);
        if (!test.ok) {
          return interaction.editReply({
            content: `${test.message}\n🚫 Nothing was saved — fix the details and try again.`,
          });
        }
        const ws = await updateWorkspace(interaction.guildId, { aiApiKey: encodeAiConfig(cfg) });
        await interaction.message.edit(await buildPanel(interaction, ws)).catch(() => {});
        return interaction.editReply({
          content: `${test.message}\n💾 Saved for this workspace only.`,
        });
      }

      let patch = null;
      if (id === "cfg_modal_org")
        patch = { organizationName: interaction.fields.getTextInputValue("org") };
      if (id === "cfg_modal_tz") {
        const tz = interaction.fields.getTextInputValue("tz").trim();
        if (!isValidTimeZone(tz)) {
          return interaction.reply({
            content: `❌ \`${tz}\` is not a valid IANA timezone. Use the dropdown or the format \`Asia/Qatar\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        patch = { timezone: tz };
      }
      if (id === "cfg_modal_cur")
        patch = { currency: interaction.fields.getTextInputValue("cur").trim().toUpperCase() };
      if (!patch) return;
      const ws = await updateWorkspace(interaction.guildId, patch);
      return interaction.update(await buildPanel(interaction, ws));
    }
  },
};
