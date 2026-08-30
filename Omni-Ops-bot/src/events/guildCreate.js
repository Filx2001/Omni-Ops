const { EmbedBuilder } = require("discord.js");
const { getWorkspace } = require("../utils/workspace");

module.exports = {
  name: "guildCreate",
  async execute(guild) {
    // 1. Create the workspace row (idempotent on the API side)
    await getWorkspace(guild.id, { create: true, guildName: guild.name }).catch(() => {});

    // 2. Welcome the server owner — they are now the System Owner
    const embed = new EmbedBuilder()
      .setColor("#2b6cb0")
      .setTitle("🎉 Omni-Ops is now active!")
      .setDescription(
        `Hi! Because you own **${guild.name}**, you are now the **System Owner** of this Omni-Ops workspace.\n\n` +
          `**Setup takes 1 minute, no technical skills needed:**\n` +
          `1️⃣ Go to any channel and type \`/config setup\`\n` +
          `2️⃣ Tap the buttons to set your name, timezone, currency and channels\n` +
          `3️⃣ Done! Use \`/help\` to see everything your team can do.\n\n` +
          `You can also link your team with \`/employee create\` + \`/employee link\`.`
      )
      .setTimestamp();

    try {
      const owner = await guild.fetchOwner();
      await owner.send({ embeds: [embed] });
    } catch {
      // Owner DMs closed → post in the system channel instead
      const channel =
        guild.systemChannel ||
        guild.channels.cache.find(
          (c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has("SendMessages")
        );
      if (channel) await channel.send({ embeds: [embed] });
    }
  },
};
