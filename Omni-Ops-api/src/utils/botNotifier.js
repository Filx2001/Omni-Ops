// بيبلّغ بوت الديسكورد بالأحداث عن طريق شبكة Railway الداخلية

const BOT_URL = process.env.BOT_NOTIFY_URL || "http://discord-bot.railway.internal:3001";
//
async function notifyBot(path, payload) {
  // مفيش لينك أو مفتاح؟ نسكت — التنبيهات مش حرجة
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
