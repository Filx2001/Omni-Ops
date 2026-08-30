const { EmbedBuilder } = require("discord.js");

module.exports = {
  name: "guildUpdate",
  async execute(oldGuild, newGuild) {
    if (oldGuild.ownerId === newGuild.ownerId) return;

    const note = new EmbedBuilder()
      .setColor("#f1c40f")
      .setTitle("🔑 System Ownership Transferred")
      .setDescription(
        `Discord server ownership of **${newGuild.name}** changed.\n` +
          `The Omni-Ops System Owner is now <@${newGuild.ownerId}>.\n` +
          `Full control (\`/config\`, promotions, deletion) moved with it automatically.`
      )
      .setTimestamp();

    for (const id of [oldGuild.ownerId, newGuild.ownerId]) {
      try {
        const user = await newGuild.client.users.fetch(id);
        await user.send({ embeds: [note] });
      } catch {}
    }
  },
};
