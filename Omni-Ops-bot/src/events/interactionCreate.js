const { runWithTenant } = require("../utils/tenantContext");
const configPanel = require("../commands/config");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    // Attach the guild's workspace to every API call made inside this interaction
    const run = (fn) => (interaction.guildId ? runWithTenant(interaction.guildId, fn) : fn());

    // 1. Modals
    if (interaction.isModalSubmit()) {
      // Control panel modals
      if (interaction.customId.startsWith("cfg_")) {
        return run(() => configPanel.handleComponent(interaction));
      }
      // Existing lead modals (kept)
      const leadCommand = interaction.client.commands.get("lead");
      if (interaction.customId === "filterModal") {
        if (leadCommand?.handleFilterModal) {
          await leadCommand.handleFilterModal(interaction);
        }
        return;
      }
      if (interaction.customId.startsWith("multiAddModal_")) {
        if (leadCommand?.handleMultiAddModal) {
          await leadCommand.handleMultiAddModal(interaction);
        }
        return;
      }
      return;
    }

    // 2. Control panel buttons
    if (interaction.isButton() && interaction.customId?.startsWith("cfg_")) {
      return run(() => configPanel.handleComponent(interaction));
    }

    // 3. Autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await run(() => command.autocomplete(interaction));
        } catch (error) {
          console.error("Autocomplete error:", error);
        }
      }
      return;
    }

    // 4. Slash commands
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await run(() => command.execute(interaction));
    } catch (error) {
      console.error(error);
      // Crash protection for expired interactions (kept)
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction
            .editReply({ content: "❌ Something went wrong while running the command." })
            .catch(() => {});
        } else {
          await interaction
            .reply({
              content: "❌ Something went wrong while running the command.",
              ephemeral: true,
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error("Failed to send error reply:", e);
      }
    }
  },
};
