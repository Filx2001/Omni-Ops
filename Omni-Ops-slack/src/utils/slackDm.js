const { runWithTenant } = require("./tenantContext");

/**
 * Sends a direct message to a Slack user.
 */
async function sendSlackDM(app, slackUserId, workspaceId, blocks) {
  try {
    await runWithTenant(workspaceId, async () => {
      // Open a DM channel with the user
      const conversation = await app.client.conversations.open({
        users: slackUserId,
      });

      // Send the message
      await app.client.chat.postMessage({
        channel: conversation.channel.id,
        blocks: blocks,
      });
    });
  } catch (error) {
    console.error(`Failed to send DM to ${slackUserId}:`, error.message);
  }
}

module.exports = {
  sendSlackDM,
};
