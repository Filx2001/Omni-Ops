/**
 * Direct message helpers for Slack.
 */

const { runWithTenant } = require("./tenantContext");

/**
 * Opens (or reuses) a DM channel and posts a message.
 * Use this inside view handlers, where `say` is not available.
 */
async function sendDm(client, slackUserId, { text, blocks }) {
  const conversation = await client.conversations.open({ users: slackUserId });
  return client.chat.postMessage({
    channel: conversation.channel.id,
    text,
    blocks,
  });
}

/**
 * Tenant-wrapped DM for code that runs outside an interaction (scheduler, events).
 */
async function sendSlackDM(app, slackUserId, workspaceId, blocks, text) {
  await runWithTenant(workspaceId, async () => {
    await sendDm(app.client, slackUserId, { text, blocks });
  });
}

module.exports = { sendDm, sendSlackDM };
