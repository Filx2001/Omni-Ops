const { Events, EmbedBuilder } = require("discord.js");
const { getWorkspace } = require("../utils/workspace");

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      // Fetch workspace settings (multi-tenant aware)
      const settings = await getWorkspace(member.guild.id).catch(() => null);
      if (!settings) return;

      // 1. Assign Auto Role
      if (settings.autoRoleId) {
        const role = member.guild.roles.cache.get(settings.autoRoleId);
        if (role) {
          await member.roles
            .add(role)
            .catch((err) => console.error("⚠️ Failed to assign auto-role:", err.message));
        } else {
          console.error(
            `⚠️ Auto-role ${settings.autoRoleId} not found in guild ${member.guild.id}`
          );
        }
      }

      // 2. Welcome DM (private)
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor("#0099ff")
          .setTitle(` Welcome to ${member.guild.name}!`)
          .setDescription(
            `Hi ${member.displayName}, we're glad to have you here!\n\n` +
              (settings.introChannelId
                ? `To get started, head over to <#${settings.introChannelId}> and introduce yourself. 🚀`
                : `Feel free to look around and say hi! 🚀`)
          )
          .setThumbnail(member.guild.iconURL({ dynamic: true }))
          .setTimestamp();

        await member.send({ embeds: [dmEmbed] });
      } catch (err) {
        // User has DMs closed — the public channel message below still covers them
        console.error(`⚠️ Could not DM new member ${member.user.tag}:`, err.message);
      }

      // 3. Public welcome channel message
      if (settings.welcomeChannelId && settings.introChannelId) {
        const welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (welcomeChannel) {
          const welcomeEmbed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle("👋 Welcome to the server!")
            .setDescription(
              `Glad to have you here, ${member}!\n\nTo get started, please head over to <#${settings.introChannelId}> and introduce yourself:\n• Your name and role/specialization\n• Your goals or what you'd like to achieve\n\nWe hope you have a great time with us! 🚀`
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

          await welcomeChannel.send({ content: `Welcome ${member}`, embeds: [welcomeEmbed] });
        }
      }
    } catch (error) {
      console.error("❌ Error in GuildMemberAdd event:", error.message);
    }
  },
};
