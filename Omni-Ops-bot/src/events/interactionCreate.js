const { runWithTenant } = require("../utils/tenantContext");

async function handleInteraction(interaction) {
  // ───────────── 1. MODALS ─────────────
  if (interaction.isModalSubmit()) {
    const leadCommand = interaction.client.commands.get("lead");
    if (interaction.customId === "filterModal") {
      if (leadCommand?.handleFilterModal) await leadCommand.handleFilterModal(interaction);
      return;
    }
    if (interaction.customId.startsWith("multiAddModal_")) {
      if (leadCommand?.handleMultiAddModal) await leadCommand.handleMultiAddModal(interaction);
      return;
    }
    if (interaction.customId.startsWith("cfg_")) {
      const configCommand = interaction.client.commands.get("config");
      if (configCommand?.handleComponent) {
        try {
          await configCommand.handleComponent(interaction);
        } catch (error) {
          console.error("Config modal error:", error);
        }
      }
      return;
    }
    return;
  }

  // ───────────── 2. BUTTONS & SELECT MENUS ─────────────
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    if (interaction.customId?.startsWith("cfg_")) {
      const configCommand = interaction.client.commands.get("config");
      if (configCommand?.handleComponent) {
        try {
          await configCommand.handleComponent(interaction);
        } catch (error) {
          console.error("Config component error:", error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction
              .reply({ content: "❌ Something went wrong updating settings.", ephemeral: true })
              .catch(() => {});
          }
        }
      }
      return;
    }
    return;
  }

  // ───────────── 3. AUTOCOMPLETE ─────────────
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error("Autocomplete error:", error);
      }
    }
    return;
  }

  // ───────────── 4. SLASH COMMANDS ─────────────
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({ content: "❌ Something went wrong while running the command." })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: "❌ Something went wrong while running the command.", ephemeral: true })
          .catch(() => {});
      }
    } catch (e) {
      console.error("Failed to send error reply:", e);
    }
  }
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    // Attach the guild's workspace to the WHOLE interaction so every axios
    // call (commands, autocomplete, buttons, modals) sends X-Workspace-Id.
    return runWithTenant(interaction.guildId, () => handleInteraction(interaction));
  },
};
