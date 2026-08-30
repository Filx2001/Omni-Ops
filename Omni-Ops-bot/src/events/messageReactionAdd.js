const { Events } = require("discord.js");
const messageCreateHandler = require("./messageCreate");
const { runWithTenant } = require("../utils/tenantContext");
const { pendingActions, executeAction } = messageCreateHandler;

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch (err) {
        return;
      }
    }

    const emoji = reaction.emoji.name;
    if (emoji !== "✅" && emoji !== "❌") return;

    const pending = pendingActions.get(user.id);
    if (!pending) return;
    if (pending.confirmMessageId !== reaction.message.id) return;

    if (pending.expiresAt < Date.now()) {
      pendingActions.delete(user.id);
      try {
        await reaction.message.reply(
          "⌛ Confirmation request expired. Please send the request again."
        );
      } catch (err) {}
      return;
    }

    pendingActions.delete(user.id);

    if (emoji === "❌") {
      try {
        await reaction.message.reply("🚫 Operation cancelled.");
      } catch (err) {}
      return;
    }

    // Execute within the correct tenant context stored when the action was requested
    const run = pending.workspaceId ? (fn) => runWithTenant(pending.workspaceId, fn) : (fn) => fn();

    try {
      const resultMsg = await run(() =>
        executeAction(pending.call, pending.call.args, pending.manager, reaction.message)
      );
      await reaction.message.reply(resultMsg);
    } catch (error) {
      console.error("DM AI Reaction Execute Error:", error);
      try {
        await reaction.message.reply(
          `❌ Operation failed: ${error.response?.data?.error || error.message}`
        );
      } catch (err) {}
    }
  },
};
