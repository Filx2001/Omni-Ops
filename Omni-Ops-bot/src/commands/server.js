const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const EMBED_COLORS = require("../utils/embedColors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Centralized server management and moderation")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // ==========================================
    // 1. MEMBER GROUP (timeout, untimeout, kick, ban)
    // ==========================================
    .addSubcommandGroup((group) =>
      group
        .setName("member")
        .setDescription("Manage server members")
        .addSubcommand((sub) =>
          sub
            .setName("timeout")
            .setDescription("Timeout a member")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("The member to timeout").setRequired(true)
            )
            .addIntegerOption((opt) =>
              opt.setName("duration").setDescription("Duration in minutes").setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName("reason").setDescription("Reason for timeout").setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("untimeout")
            .setDescription("Remove timeout from a member")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("The member").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("kick")
            .setDescription("Kick a member from the server")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("The member to kick").setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName("reason").setDescription("Reason for kicking").setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("ban")
            .setDescription("Ban a member from the server")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("The member to ban").setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName("reason").setDescription("Reason for banning").setRequired(false)
            )
        )
    )
    // ==========================================
    // 2. CHANNEL GROUP (create, edit, delete, lock, unlock)
    // ==========================================
    .addSubcommandGroup((group) =>
      group
        .setName("channel")
        .setDescription("Manage text and voice channels")
        .addSubcommand((sub) =>
          sub
            .setName("create")
            .setDescription("Create a new channel")
            .addStringOption((opt) =>
              opt.setName("name").setDescription("Channel name").setRequired(true)
            )
            .addIntegerOption((opt) =>
              opt
                .setName("type")
                .setDescription("Channel type")
                .setRequired(true)
                .addChoices(
                  { name: "Text", value: ChannelType.GuildText },
                  { name: "Voice", value: ChannelType.GuildVoice }
                )
            )
            .addChannelOption((opt) =>
              opt
                .setName("category")
                .setDescription("Parent category")
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("edit")
            .setDescription("Rename an existing channel")
            .addChannelOption((opt) =>
              opt.setName("channel").setDescription("The channel").setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName("new_name").setDescription("New name").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("Delete a channel")
            .addChannelOption((opt) =>
              opt.setName("channel").setDescription("The channel to delete").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("lock")
            .setDescription("Lock a text channel")
            .addChannelOption((opt) =>
              opt
                .setName("channel")
                .setDescription("The channel to lock (defaults to current)")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("unlock")
            .setDescription("Unlock a text channel")
            .addChannelOption((opt) =>
              opt
                .setName("channel")
                .setDescription("The channel to unlock (defaults to current)")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
            )
        )
    )
    // ==========================================
    // 3. CATEGORY GROUP (create, edit, delete)
    // ==========================================
    .addSubcommandGroup((group) =>
      group
        .setName("category")
        .setDescription("Manage channel categories")
        .addSubcommand((sub) =>
          sub
            .setName("create")
            .setDescription("Create a new category")
            .addStringOption((opt) =>
              opt.setName("name").setDescription("Category name").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("edit")
            .setDescription("Rename a category")
            .addChannelOption((opt) =>
              opt
                .setName("category")
                .setDescription("The category")
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName("new_name").setDescription("New name").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("Delete a category")
            .addChannelOption((opt) =>
              opt
                .setName("category")
                .setDescription("The category to delete")
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
            )
        )
    )
    // ==========================================
    // 4. MESSAGES GROUP (clear)
    // ==========================================
    .addSubcommandGroup((group) =>
      group
        .setName("messages")
        .setDescription("Manage messages")
        .addSubcommand((sub) =>
          sub
            .setName("clear")
            .setDescription("Delete multiple messages at once")
            .addIntegerOption((opt) =>
              opt
                .setName("amount")
                .setDescription("Number of messages (1-100)")
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
            )
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const group = interaction.options.getSubcommandGroup();
    const command = interaction.options.getSubcommand();
    const guild = interaction.guild;

    try {
      // ==========================================
      // LOGIC FOR MEMBER GROUP
      // ==========================================
      if (group === "member") {
        const targetUser = interaction.options.getMember("user");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!targetUser) return interaction.editReply("❌ Could not find that member.");
        if (targetUser.id === guild.ownerId)
          return interaction.editReply("❌ You cannot modify the server owner.");
        if (targetUser.roles.highest.position >= interaction.member.roles.highest.position) {
          return interaction.editReply("❌ You cannot modify this member due to role hierarchy.");
        }

        if (command === "timeout") {
          const durationMins = interaction.options.getInteger("duration");
          await targetUser.timeout(durationMins * 60 * 1000, reason);
          return interaction.editReply(
            `✅ **${targetUser.user.tag}** has been timed out for ${durationMins} minutes. Reason: ${reason}`
          );
        }
        if (command === "untimeout") {
          await targetUser.timeout(null, "Timeout removed manually");
          return interaction.editReply(`✅ Timeout removed from **${targetUser.user.tag}**.`);
        }
        if (command === "kick") {
          await targetUser.kick(reason);
          return interaction.editReply(
            `✅ **${targetUser.user.tag}** has been kicked. Reason: ${reason}`
          );
        }
        if (command === "ban") {
          await targetUser.ban({ reason: reason });
          return interaction.editReply(
            `✅ **${targetUser.user.tag}** has been banned. Reason: ${reason}`
          );
        }
      }
      // ==========================================
      // LOGIC FOR CHANNEL GROUP
      // ==========================================
      else if (group === "channel") {
        if (command === "create") {
          const name = interaction.options.getString("name");
          const type = interaction.options.getInteger("type");
          const category = interaction.options.getChannel("category");
          const newChannel = await guild.channels.create({
            name: name,
            type: type,
            parent: category ? category.id : null,
          });
          return interaction.editReply(`✅ Channel ${newChannel} has been created successfully.`);
        }
        if (command === "edit") {
          const channel = interaction.options.getChannel("channel");
          const newName = interaction.options.getString("new_name");
          await channel.edit({ name: newName });
          return interaction.editReply(`✅ Channel renamed to **${newName}**.`);
        }
        if (command === "delete") {
          const channel = interaction.options.getChannel("channel");
          const channelName = channel.name;
          await channel.delete();
          return interaction.editReply(`✅ Channel **${channelName}** has been deleted.`);
        }
        if (command === "lock" || command === "unlock") {
          const channel = interaction.options.getChannel("channel") || interaction.channel;
          const isLock = command === "lock";
          await channel.permissionOverwrites.edit(guild.id, {
            SendMessages: isLock ? false : null,
          });
          const embed = new EmbedBuilder()
            .setColor(isLock ? "#ff0000" : "#00ff00")
            .setTitle(isLock ? "🔒 Channel Locked" : "🔓 Channel Unlocked")
            .setDescription(
              isLock
                ? "This channel has been locked by a moderator."
                : "This channel is now open for messages."
            );
          await channel.send({ embeds: [embed] });
          return interaction.editReply(
            `✅ Channel ${channel} has been ${isLock ? "locked" : "unlocked"}.`
          );
        }
      }
      // ==========================================
      // LOGIC FOR CATEGORY GROUP
      // ==========================================
      else if (group === "category") {
        if (command === "create") {
          const name = interaction.options.getString("name");
          await guild.channels.create({
            name: name,
            type: ChannelType.GuildCategory,
          });
          return interaction.editReply(`✅ Category **${name}** has been created.`);
        }
        if (command === "edit") {
          const category = interaction.options.getChannel("category");
          const newName = interaction.options.getString("new_name");
          await category.edit({ name: newName });
          return interaction.editReply(`✅ Category renamed to **${newName}**.`);
        }
        if (command === "delete") {
          const category = interaction.options.getChannel("category");
          const catName = category.name;
          await category.delete();
          return interaction.editReply(`✅ Category **${catName}** has been deleted.`);
        }
      }
      // ==========================================
      // LOGIC FOR MESSAGES GROUP
      // ==========================================
      else if (group === "messages") {
        if (command === "clear") {
          const amount = interaction.options.getInteger("amount");
          const deleted = await interaction.channel.bulkDelete(amount, true);
          return interaction.editReply(`✅ Successfully deleted **${deleted.size}** messages.`);
        }
      }
    } catch (error) {
      console.error(error);
      return interaction.editReply(`❌ An error occurred: ${error.message}`);
    }
  },
};
