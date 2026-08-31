// Notifies the Discord bot about events over the private network / localhost.
// The bot runs an internal Express server (src/server.js) that only the API can reach.

const BOT_URL = process.env.BOT_NOTIFY_URL || "http://localhost:3001";

async function notifyBot(path, payload) {
  // No API key configured? Skip silently — notifications are non-critical.
  if (!process.env.INTERNAL_API_KEY) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${BOT_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[Notify] Bot returned ${response.status}`);
    }
  } catch (error) {
    // ECONNREFUSED happens if the bot is down or the URL is wrong.
    // We log it but never throw — a failed notification must not crash a webhook.
    console.error(
      "[Notify] Could not reach the bot:",
      error.message,
      error.cause?.code || "",
      `url=${BOT_URL}${path}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

const notifyNewLead = (lead) => notifyBot("/notify/new-lead", lead);

module.exports = { notifyNewLead };
