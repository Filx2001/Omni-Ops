/**
 * Delivery helpers: confirmations follow the user back to the channel where
 * the interaction started; personal pushes (reminders) always stay in DMs.
 */

const { runWithTenant } = require("./tenantContext");

const origins = new Map();
const ORIGIN_TTL_MS = 10 * 60 * 1000;

/** Records the channel a command or button press came from (DMs ignored). */
function rememberOrigin(userId, channelId) {
  if (!userId || !channelId || String(channelId).startsWith("D")) return;
  origins.set(userId, { channelId, at: Date.now() });
}

/** Origin channel for a user, or null when unknown/expired. */
function originChannel(userId) {
  const hit = origins.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > ORIGIN_TTL_MS) {
    origins.delete(userId);
    return null;
  }
  return hit.channelId;
}

/** Plain DM: opens (or reuses) the DM channel and posts. */
async function postDm(client, userId, { text, blocks }) {
  const conversation = await client.conversations.open({ users: userId });
  return client.chat.postMessage({ channel: conversation.channel.id, text, blocks });
}

/**
 * Confirmation delivery: ephemeral in the originating channel when known,
 * DM otherwise (modals opened from DMs or expired origins).
 */
async function sendDm(client, userId, payload) {
  const channelId = originChannel(userId);
  if (channelId) {
    try {
      return await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: payload.text,
        blocks: payload.blocks,
      });
    } catch (error) {
      console.error("[Delivery] ephemeral failed, falling back to DM:", error.message);
    }
  }
  return postDm(client, userId, payload);
}

/** Personal push (reminders): always DM, tenant-wrapped. Accepts both payload shapes. */
async function sendSlackDM(app, slackUserId, workspaceId, payloadOrBlocks, maybeText) {
  const payload = Array.isArray(payloadOrBlocks)
    ? { blocks: payloadOrBlocks, text: maybeText }
    : payloadOrBlocks;
  await runWithTenant(workspaceId, async () => {
    await postDm(app.client, slackUserId, payload);
  });
}

module.exports = { sendDm, sendSlackDM, rememberOrigin, postDm };
