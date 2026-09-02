const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const axios = require("../utils/axiosInstance");
const { requireRole, MANAGEMENT_ROLES } = require("../utils/requireRole");
const EMBED_COLORS = require("../utils/embedColors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Rebuild Google Sheets from the database (source of truth)")
    .addStringOption((o) =>
      o
        .setName("target")
        .setDescription("What to sync — leave empty to sync EVERYTHING")
        .setRequired(false)
        .addChoices(
          { name: "👤 Leads", value: "leads" },
          { name: "📅 Schedule (appointments + events)", value: "schedule" },
          { name: "🧾 Accounting (invoices)", value: "accounting" },
          { name: "✅ Personal tasks", value: "personal" }
        )
    ),

  async execute(interaction) {
    const manager = await requireRole(interaction, MANAGEMENT_ROLES);
    if (!manager) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getString("target");

    try {
      const res = await axios.post("/sheets/sync", { targets: target ? [target] : [] });
      const r = res.data;
      const lines = [];
      if (r.leads)
        lines.push(`👤 **Leads:** ${r.leads.rows} row(s) in ${r.leads.tabs} month tab(s)`);
      if (r.schedule !== undefined) lines.push(`📅 **Schedule:** ${r.schedule} row(s)`);
      if (r.accounting !== undefined)
        lines.push(`🧾 **Accounting:** ${r.accounting} invoice row(s)`);
      if (r.personal)
        lines.push(`✅ **Personal tasks:** ${r.personal.rows} row(s) in ${r.personal.tabs} tab(s)`);

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS || EMBED_COLORS.INFO)
        .setTitle("🔄 Google Sheets Synced")
        .setDescription(lines.join("\n") || "Nothing to sync.")
        .setFooter({
          text: "Database is the source of truth. Payment & Notes columns are preserved.",
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
    }
  },
};
