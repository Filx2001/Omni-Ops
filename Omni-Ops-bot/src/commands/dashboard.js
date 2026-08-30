const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getDashboard } = require("../services/api.service");
const EMBED_COLORS = require("../utils/embedColors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("View Omni-Ops management dashboard"),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const stats = await getDashboard();
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.INFO)
        .setTitle("📊 Omni-Ops Management Dashboard")
        .setDescription("Real-time overview of employees and tasks")
        .addFields(
          { name: "👥 Employees", value: String(stats.totalEmployees), inline: true },
          { name: "📋 Total Tasks", value: String(stats.totalTasks), inline: true },
          { name: "📂 Open Tasks", value: String(stats.openTasks), inline: true },
          { name: "⏳ Pending", value: String(stats.pendingTasks), inline: true },
          { name: "✅ Completed", value: String(stats.completedTasks), inline: true },
          { name: "🚨 Overdue", value: String(stats.overdueTasks), inline: true },
          { name: "🔥 High Priority", value: String(stats.highPriorityTasks), inline: true },
          { name: "⚡ Urgent", value: String(stats.urgentTasks), inline: true }
        )
        .setFooter({
          text: "Omni-Ops Management System",
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply("❌ Failed to fetch dashboard data.");
    }
  },
};
