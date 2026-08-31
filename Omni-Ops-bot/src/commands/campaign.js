const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");

const STATUS_ICONS = { DRAFT: "📝", RUNNING: "📤", PAUSED: "⏸️", DONE: "✅" };
const LEAD_STATUS_LABELS = {
  NEW: "🆕 New",
  CONTACTED: "📞 Contacted",
  QUALIFIED: "⭐ Qualified",
  CONVERTED: "✅ Converted",
  LOST: "🚫 Not Interested",
};

// Day suggestions — just shortcuts; managers can type any number from 1 to 730
const DAY_SUGGESTIONS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const DAY_OPTIONS = ["added_within", "added_before", "active_within", "active_before", "cooldown"];

// How many names to show inside the embed — the rest goes in the attached file
const NAMES_IN_EMBED = 20;

// Confirm button timeout. If it expires, /campaign send still works — the campaign is saved as DRAFT
const CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;

/** Builds a text file with the full recipient list */
function buildRecipientsFile(campaignName, recipients) {
  const lines = [
    `Campaign: ${campaignName}`,
    `Recipients: ${recipients.length}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "#    NAME                           PHONE",
    "-".repeat(60),
  ];
  recipients.forEach((r, i) => {
    const num = String(i + 1).padEnd(5);
    const name = String(r.name || "Unknown")
      .slice(0, 30)
      .padEnd(31);
    lines.push(`${num}${name}${r.phone || "N/A"}`);
  });
  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), {
    name: `recipients-${campaignName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`,
  });
}

/** Turns the API funnel into readable lines */
function funnelLines(funnel = []) {
  return funnel
    .filter((s) => s.removed > 0)
    .map((s) => {
      const icon = s.kind === "block" ? "🛡️" : "🎯";
      return `${icon} −${s.removed} · ${s.label}`;
    });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("campaign")
    .setDescription("WhatsApp bulk campaigns")
    .addSubcommand((sub) =>
      sub.setName("audience").setDescription("Explore your contact base before creating a campaign")
    )
    .addSubcommand((sub) =>
      sub
        .setName("new")
        .setDescription("Create a campaign and preview exactly who will receive it")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Campaign name (for your records)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("template")
            .setDescription("Approved WhatsApp template")
            .setRequired(true)
            .setAutocomplete(true)
        )
        // Everything below is optional. Left empty = everyone reachable gets the message.
        .addIntegerOption((option) =>
          option
            .setName("added_within")
            .setDescription("Added to the system in the last N days (e.g. 1 for today's contacts)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(730)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("added_before")
            .setDescription("In the system for more than N days (older contacts)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(730)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("active_within")
            .setDescription("Messaged us in the last N days")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(730)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("active_before")
            .setDescription("Their last message is older than N days (dormant contacts)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(730)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("source")
            .setDescription("Only contacts from this source")
            .setRequired(false)
            .addChoices(
              { name: "WhatsApp", value: "WHATSAPP" },
              { name: "Website", value: "WEBSITE" },
              { name: "Added manually", value: "MANUAL" },
              { name: "Imported", value: "IMPORT" },
              { name: "Phone call", value: "PHONE" },
              { name: "Walk-in", value: "WALK_IN" },
              { name: "Social media", value: "SOCIAL" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("lead_status")
            .setDescription("Only contacts with this status")
            .setRequired(false)
            .addChoices(
              { name: "🆕 New", value: "NEW" },
              { name: "📞 Contacted", value: "CONTACTED" },
              { name: "⭐ Qualified", value: "QUALIFIED" },
              { name: "✅ Converted", value: "CONVERTED" },
              { name: "🚫 Not Interested", value: "LOST" }
            )
        )
        .addAttachmentOption((option) =>
          option
            .setName("image")
            .setDescription("Required if the template has an image/video/file header")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("variables")
            .setDescription("Template values, comma separated. Use {name} for the contact's name")
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("cooldown")
            .setDescription("Skip contacts marketed to within N days (minimum 7, default 14)")
            .setRequired(false)
            .setMinValue(7)
            .setMaxValue(365)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("send")
        .setDescription("Start sending a campaign you already previewed")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign to send")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("recipients")
        .setDescription("Full list of who a campaign will reach (or reached)")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Live progress of a campaign")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Pause a running campaign immediately")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign to stop")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Campaign history"))
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Full details of one campaign")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });
    try {
      // Campaigns are management-only — they cost money and affect the sender rating
      const employeeResponse = await axios.get(
        ` /employees/external/${interaction.user.id}`
      );
      const employee = employeeResponse.data;
      if (!["Admin", "Manager"].includes(employee.role?.name)) {
        return interaction.editReply("❌ Management only. Campaigns are restricted.");
      }

      // ========================== Audience ==========================
      if (subcommand === "audience") {
        const { data } = await axios.get(`/campaigns/audience`);
        const statusLines = Object.entries(data.byStatus)
          .map(([key, count]) => `${LEAD_STATUS_LABELS[key] || key}: **${count}**`)
          .join("\n");
        const sourceLines = Object.entries(data.bySource)
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => `${key}: **${count}**`)
          .join("\n");
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO || 0x0099ff)
          .setTitle("👥 Contact Base")
          .setDescription(
            `**${data.reachable}** of **${data.total}** contacts can receive marketing.\n` +
              `Use any combination of filters in \`/campaign new\` — leaving them empty targets everyone.`
          )
          .addFields(
            {
              name: "🚫 Cannot be reached",
              value: `Opted out: **${data.optedOut}**\nNo phone: **${data.noPhone}**`,
              inline: true,
            },
            {
              name: "🆕 Added recently",
              value:
                `Last 24h: **${data.added.d1}**\n` +
                `Last 7 days: **${data.added.d7}**\n` +
                `Last 30 days: **${data.added.d30}**`,
              inline: true,
            },
            {
              name: "🗂️ In the system for over",
              value:
                `3 months: **${data.inSystem.m3}**\n` +
                `6 months: **${data.inSystem.m6}**\n` +
                `1 year: **${data.inSystem.y1}**`,
              inline: true,
            },
            {
              name: "💬 Messaged us within",
              value:
                `7 days: **${data.activity.d7}**\n` +
                `30 days: **${data.activity.d30}**\n` +
                `60 days: **${data.activity.d60}**\n` +
                `Never messaged: **${data.activity.never}**`,
              inline: true,
            },
            {
              name: "😴 Last message older than",
              value: `3 months: **${data.dormant.m3}**\n6 months: **${data.dormant.m6}**`,
              inline: true,
            },
            { name: "📥 By source", value: sourceLines || "No data", inline: true },
            { name: "🚦 By status", value: statusLines || "No data", inline: false },
            {
              name: "🧊 On cooldown",
              value: `**${data.recentlyMarketed}** were marketed to in the last 7 days`,
              inline: false,
            }
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== New ==========================
      else if (subcommand === "new") {
        const templateValue = interaction.options.getString("template");
        const rawVariables = interaction.options.getString("variables");
        // Autocomplete returns "name|language"
        const [templateName, templateLanguage = "en"] = templateValue.split("|");
        const payload = {
          name: interaction.options.getString("name"),
          templateName,
          templateLanguage,
          variables: rawVariables
            ? rawVariables
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : [],
          addedWithinDays: interaction.options.getInteger("added_within"),
          addedBeforeDays: interaction.options.getInteger("added_before"),
          activeWithinDays: interaction.options.getInteger("active_within"),
          activeBeforeDays: interaction.options.getInteger("active_before"),
          audienceSource: interaction.options.getString("source") || null,
          audienceStatus: interaction.options.getString("lead_status") || null,
          cooldownDays: interaction.options.getInteger("cooldown") || 14,
          headerMediaUrl: interaction.options.getAttachment("image")?.url || null,
          createdById: employee.id,
          createdByName: employee.name,
        };
        const { data } = await axios.post(`/campaigns`, payload);
        const { campaign, eligible, funnel, deferredToNextBatch, audienceLabel } = data;

        // Full list with names — this is what gets reviewed before confirming
        const { data: list } = await axios.get(
          `/campaigns/${campaign.id}/recipients`
        );
        const recipients = list.recipients || [];
        const shown = recipients.slice(0, NAMES_IN_EMBED);
        const namesBlock = shown
          .map((r, i) => `\`${String(i + 1).padStart(3)}\` ${r.name} — \`${r.phone}\``)
          .join("\n");
        const restCount = recipients.length - shown.length;
        const etaMinutes = Math.ceil((eligible * 2) / 60);
        const removedTotal = funnelLines(funnel).length
          ? (funnel || []).reduce((sum, s) => sum + s.removed, 0)
          : 0;

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.WARNING || 0xffa500)
          .setTitle(`📋 ${campaign.name}`)
          .setDescription(
            "**Nothing has been sent yet.**\nReview the list below, then press Confirm to start sending."
          )
          .addFields(
            {
              name: "📨 Template",
              value: `\`${templateName}\` (${templateLanguage})`,
              inline: true,
            },
            { name: "🎯 Audience", value: audienceLabel || "Everyone reachable", inline: true },
            {
              name: "🧊 Cooldown",
              value:
                `${payload.cooldownDays} days` +
                (campaign.headerFormat
                  ? `\n🖼️ ${campaign.headerFormat.toLowerCase()} header attached`
                  : ""),
              inline: true,
            },
            { name: "✅ Will receive", value: `**${eligible}** contacts`, inline: true },
            { name: "❌ Filtered out", value: `**${removedTotal}** contacts`, inline: true },
            { name: "⏱️ Estimated time", value: `~${etaMinutes} min`, inline: true },
            {
              name: "🔎 How the list was narrowed",
              value: funnelLines(funnel).join("\n").slice(0, 1024) || "Nothing was removed",
              inline: false,
            },
            {
              name: `👤 Who will receive this${restCount > 0 ? ` (first ${shown.length} of ${recipients.length})` : ""}`,
              value: (namesBlock || "No recipients").slice(0, 1024),
              inline: false,
            }
          );
        if (restCount > 0) {
          embed.addFields({
            name: "📎 Full list",
            value: `The remaining **${restCount}** are in the attached file. Open it before confirming.`,
            inline: false,
          });
        }
        if (deferredToNextBatch > 0) {
          embed.addFields({
            name: "📦 Batch limit",
            value:
              `**${deferredToNextBatch}** more contacts matched but were held back.\n` +
              `Send this batch, check your quality rating, then create another campaign.`,
            inline: false,
          });
        }
        embed.setFooter({
          text: "Buttons expire in 10 minutes — /campaign send still works after",
        });
        embed.setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`campaign_confirm_${campaign.id}`)
            .setLabel(`Confirm and send to ${eligible}`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("📤"),
          new ButtonBuilder()
            .setCustomId(`campaign_cancel_${campaign.id}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        );
        const files = recipients.length ? [buildRecipientsFile(campaign.name, recipients)] : [];
        const message = await interaction.editReply({
          embeds: [embed],
          components: [buttons],
          files,
        });

        // ---------- Wait for confirmation ----------
        try {
          const press = await message.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id,
            time: CONFIRM_TIMEOUT_MS,
          });
          if (press.customId.startsWith("campaign_cancel_")) {
            await press.update({
              embeds: [
                EmbedBuilder.from(embed)
                  .setColor(EMBED_COLORS.DELETE || 0xff0000)
                  .setDescription(
                    "**Cancelled. Nothing was sent.**\n" +
                      `The draft is still saved — you can send it later with \`/campaign send\`.`
                  ),
              ],
              components: [],
            });
            return;
          }
          await press.deferUpdate();
          const { data: started } = await axios.post(
            `/campaigns/${campaign.id}/start`
          );
          const sending = new EmbedBuilder()
            .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
            .setTitle("📤 Campaign Started")
            .setDescription(`**${started.name}** is now sending.`)
            .addFields(
              { name: "👥 Recipients", value: `${started.total}`, inline: true },
              { name: "⏱️ Estimated time", value: `~${started.etaMinutes} min`, inline: true }
            )
            .setFooter({ text: "Check progress with /campaign status · stop with /campaign stop" })
            .setTimestamp();
          await interaction.editReply({ embeds: [sending], components: [] });
        } catch (err) {
          // Timeout or bot restart — the campaign is still saved as DRAFT
          await interaction
            .editReply({
              embeds: [
                EmbedBuilder.from(embed)
                  .setDescription(
                    "**Nothing has been sent.** The confirmation window closed.\n" +
                      `Send it when you're ready: \`/campaign send\` → **${campaign.name}**`
                  )
                  .setFooter({ text: "The draft and its recipient list are saved" }),
              ],
              components: [],
            })
            .catch(() => {});
        }
        return;
      }
      // ========================== Send ==========================
      else if (subcommand === "send") {
        const campaignId = interaction.options.getString("campaign");
        const { data } = await axios.post(`/campaigns/${campaignId}/start`);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle("📤 Campaign Started")
          .setDescription(`**${data.name}** is now sending.`)
          .addFields(
            { name: "👥 Recipients", value: `${data.total}`, inline: true },
            { name: "⏱️ Estimated time", value: `~${data.etaMinutes} min`, inline: true }
          )
          .setFooter({ text: "Check progress with /campaign status" })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Recipients ==========================
      else if (subcommand === "recipients") {
        const campaignId = interaction.options.getString("campaign");
        const { data } = await axios.get(
          `/campaigns/${campaignId}/recipients`
        );
        if (!data.recipients.length) {
          return interaction.editReply("📭 This campaign has no recipients.");
        }
        const counts = {};
        for (const r of data.recipients) counts[r.status] = (counts[r.status] || 0) + 1;
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO || 0x0099ff)
          .setTitle(`👤 ${data.campaignName} — recipients`)
          .setDescription(
            Object.entries(counts)
              .map(([status, n]) => `${status}: **${n}**`)
              .join(" · ")
          )
          .addFields({
            name: `First ${Math.min(NAMES_IN_EMBED, data.recipients.length)}`,
            value: data.recipients
              .slice(0, NAMES_IN_EMBED)
              .map((r, i) => `\`${String(i + 1).padStart(3)}\` ${r.name} — \`${r.phone}\``)
              .join("\n")
              .slice(0, 1024),
            inline: false,
          })
          .setTimestamp();
        return interaction.editReply({
          embeds: [embed],
          files: [buildRecipientsFile(data.campaignName, data.recipients)],
        });
      }
      // ========================== Status ==========================
      else if (subcommand === "status") {
        const campaignId = interaction.options.getString("campaign");
        const { data } = await axios.get(`/campaigns/${campaignId}/progress`);
        const percent = data.total ? Math.round((data.sent / data.total) * 100) : 0;
        const filled = Math.round(percent / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        const embed = new EmbedBuilder()
          .setColor(data.status === "RUNNING" ? 0x3498db : EMBED_COLORS.INFO || 0x0099ff)
          .setTitle(`${STATUS_ICONS[data.status] || ""} ${data.name}`)
          .setDescription(`\`${bar}\` ${percent}%`)
          .addFields(
            { name: "✅ Sent", value: `${data.sent} / ${data.total}`, inline: true },
            { name: "❌ Failed", value: `${data.failed}`, inline: true },
            { name: "⏳ Deferred", value: `${data.deferred}`, inline: true },
            { name: "📭 Remaining", value: `${data.remaining}`, inline: true },
            { name: "⏱️ Time left", value: `~${data.etaMinutes} min`, inline: true },
            { name: "🚦 Status", value: data.status, inline: true }
          )
          .setTimestamp();
        if (data.deferred > 0) {
          embed.setFooter({
            text: "Deferred contacts hit Meta's daily marketing limit and retry automatically",
          });
        }
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Stop ==========================
      else if (subcommand === "stop") {
        const campaignId = interaction.options.getString("campaign");
        const { data } = await axios.post(`/campaigns/${campaignId}/stop`);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE || 0xff0000)
          .setTitle("⏸️ Campaign Paused")
          .setDescription(`**${data.name}** has been stopped.`)
          .addFields(
            { name: "✅ Already sent", value: `${data.sent}`, inline: true },
            { name: "📭 Not sent", value: `${data.remaining}`, inline: true }
          )
          .setFooter({ text: "Use /campaign send to resume from where it stopped" })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== List ==========================
      else if (subcommand === "list") {
        const { data } = await axios.get(`/campaigns?limit=10`);
        if (!data.length) {
          return interaction.editReply("📭 No campaigns yet. Start with `/campaign audience`.");
        }
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO || 0x0099ff)
          .setTitle("📋 Campaign History")
          .setTimestamp();
        for (const c of data) {
          const date = new Date(c.createdAt).toLocaleDateString("en-GB");
          embed.addFields({
            name: `${STATUS_ICONS[c.status] || ""} ${c.name}`,
            value:
              `${date} · Sent **${c.sent}**/${c.total}` +
              (c.failed ? ` · Failed **${c.failed}**` : "") +
              ` · Replies **${c.replies}**`,
            inline: false,
          });
        }
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Info ==========================
      else if (subcommand === "info") {
        const campaignId = interaction.options.getString("campaign");
        const { data } = await axios.get(`/campaigns/${campaignId}`);
        const replyRate = data.sent ? ((data.replies / data.sent) * 100).toFixed(1) : "0.0";
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO || 0x0099ff)
          .setTitle(`${STATUS_ICONS[data.status] || ""} ${data.name}`)
          .addFields(
            { name: "📨 Template", value: `\`${data.templateName}\``, inline: true },
            {
              name: "🎯 Audience",
              value: data.audienceLabel || "Everyone reachable",
              inline: true,
            },
            { name: "🧊 Cooldown", value: `${data.cooldownDays} days`, inline: true },
            { name: "✅ Sent", value: `${data.sent} / ${data.total}`, inline: true },
            { name: "❌ Failed", value: `${data.failed}`, inline: true },
            { name: "💬 Replies", value: `${data.replies} (${replyRate}%)`, inline: true }
          )
          .setTimestamp();
        const breakdown = Array.isArray(data.excludedBreakdown)
          ? funnelLines(data.excludedBreakdown)
          : [];
        if (breakdown.length) {
          embed.addFields({
            name: "🔎 How the list was narrowed",
            value: breakdown.join("\n").slice(0, 1024),
            inline: false,
          });
        }
        if (data.createdByName) embed.setFooter({ text: `Created by ${data.createdByName}` });
        if (data.sampleFailures?.length) {
          embed.addFields({
            name: "⚠️ Sample failures",
            value: data.sampleFailures
              .map((f) => `• ${f.name || "Unknown"} — ${String(f.error).slice(0, 60)}`)
              .join("\n"),
            inline: false,
          });
        }
        return interaction.editReply({
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`campaign_noop_${campaignId}`)
                .setLabel("Use /campaign recipients for the full list")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
            ),
          ],
        });
      }
    } catch (error) {
      console.error(error);
      const message = error.response?.data?.error || error.message;
      await interaction.editReply(`❌ ${message}`).catch(() => {});
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    try {
      // Day fields — free numbers; the suggestions are just shortcuts
      if (DAY_OPTIONS.includes(focused.name)) {
        const typed = String(focused.value || "").trim();
        const typedNumber = Number(typed);
        const choices = [];
        // Keep what the user typed as the first choice so they can confirm it
        if (Number.isInteger(typedNumber) && typedNumber > 0 && typedNumber <= 730) {
          choices.push({ name: `${typedNumber} days`, value: typedNumber });
        }
        const min = focused.name === "cooldown" ? 7 : 1;
        for (const d of DAY_SUGGESTIONS) {
          if (d < min) continue;
          if (choices.some((c) => c.value === d)) continue;
          if (typed && !String(d).startsWith(typed)) continue;
          choices.push({ name: `${d} days`, value: d });
        }
        return interaction.respond(choices.slice(0, 25));
      }
      // Approved Meta templates
      if (focused.name === "template") {
        const { data } = await axios.get(`/campaigns/templates`);
        const query = focused.value.toLowerCase();
        const choices = data
          .filter((t) => t.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((t) => ({
            name: `${t.name} (${t.language}) · ${t.variableCount} var${t.headerNeedsMedia ? ` · needs ${t.headerFormat.toLowerCase()}` : ""}`.slice(
              0,
              100
            ),
            value: `${t.name}|${t.language}`,
          }));
        return interaction.respond(choices);
      }
      // Campaigns — filtered by status depending on the subcommand
      if (focused.name === "campaign") {
        const subcommand = interaction.options.getSubcommand();
        const statusFilter =
          subcommand === "send" ? "DRAFT,PAUSED" : subcommand === "stop" ? "RUNNING" : null;
        const url = statusFilter
          ? `/campaigns/search?status=${statusFilter}`
          : `/campaigns/search`;
        const { data } = await axios.get(url);
        const query = focused.value.toLowerCase();
        const choices = data
          .filter((c) => c.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((c) => ({
            name: `${STATUS_ICONS[c.status] || ""} ${c.name}`.slice(0, 100),
            value: c.id,
          }));
        return interaction.respond(choices);
      }
      return interaction.respond([]);
    } catch (error) {
      console.error("[Campaign] Autocomplete failed:", error.message);
      return interaction.respond([]);
    }
  },
};
