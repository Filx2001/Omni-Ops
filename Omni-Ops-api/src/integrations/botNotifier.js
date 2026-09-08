const DISCORD_URL = process.env.BOT_NOTIFY_URL || "http://localhost:3001";
const SLACK_URL = process.env.SLACK_BOT_NOTIFY_URL;

async function notifyEndpoint(url, path, payload) {
  if (!url || !process.env.INTERNAL_API_KEY) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) console.error(`[Notify] ${url} returned ${response.status}`);
  } catch (error) {
    console.error(`[Notify] Could not reach ${url}:`, error.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyBot(path, payload) {
  await notifyEndpoint(DISCORD_URL, path, payload);
  if (SLACK_URL) await notifyEndpoint(SLACK_URL, path, payload);
}

const notifyNewLead = (lead) => notifyBot("/notify/new-lead", lead);
module.exports = { notifyNewLead };
