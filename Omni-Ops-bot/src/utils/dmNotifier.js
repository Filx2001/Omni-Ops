const { EmbedBuilder } = require("discord.js");
const EMBED_COLORS = require("./embedColors");
const { getWorkspace } = require("./workspace");

// Helper to format timestamps as Discord full dates
const formatTime = (date) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:F>`;

// Core DM sender — never crashes if the user's DMs are closed
async function sendDM(client, externalId, embed) {
  if (!externalId) return;
  try {
    const user = await client.users.fetch(externalId);
    await user.send({ embeds: [embed] });
  } catch {
    console.log(`⚠️ Could not send DM to ${externalId} (DMs might be closed).`);
  }
}

// ===================== 1. Appointment notifications =====================
// Accepts both the new shape (title/location) and the legacy one (subject/room)
async function notifyAppointment(client, externalId, action, itemData, actorId) {
  const embed = new EmbedBuilder().setTimestamp();
  if (action === "create") {
    embed
      .setColor(EMBED_COLORS.CREATE || EMBED_COLORS.INFO)
      .setTitle("📅 New Appointment Assigned")
      .setDescription(`Hello! You have been assigned to a new appointment by <@${actorId}>.`);
  } else if (action === "update") {
    embed
      .setColor(EMBED_COLORS.UPDATE || EMBED_COLORS.INFO)
      .setTitle("✏️ Appointment Update Notification")
      .setDescription(`Hello! An appointment assigned to you has been updated by <@${actorId}>.`);
  } else if (action === "delete") {
    embed
      .setColor(EMBED_COLORS.DELETE)
      .setTitle("🗑️ Appointment Cancelled")
      .setDescription(`Hello! An appointment assigned to you has been cancelled by <@${actorId}>.`);
  }
  embed.addFields(
    { name: "📘 Title", value: itemData.title || itemData.subject || "Unknown", inline: true },
    { name: "📍 Location", value: itemData.location || itemData.room || "TBA", inline: true },
    { name: "📅 Day", value: itemData.day || "Unknown", inline: true }
  );
  if (itemData.startTime) {
    embed.addFields({ name: "⏰ Starts", value: formatTime(itemData.startTime), inline: false });
  }
  await sendDM(client, externalId, embed);
}
// Deprecated alias — kept until cron/reports are refactored
const notifyClass = notifyAppointment;

// ===================== 2. Task notifications =====================
async function notifyTask(client, externalId, action, taskData, actorId) {
  const embed = new EmbedBuilder().setTimestamp();
  if (action === "create") {
    embed
      .setColor(EMBED_COLORS.CREATE || EMBED_COLORS.INFO)
      .setTitle("📋 New Task Assigned")
      .setDescription(`Hello! A new task has been assigned to you by <@${actorId}>.`);
  } else if (action === "update") {
    embed
      .setColor(EMBED_COLORS.UPDATE || EMBED_COLORS.INFO)
      .setTitle("✏️ Task Update Notification")
      .setDescription(`Hello! A task assigned to you has been updated by <@${actorId}>.`);
  } else if (action === "delete") {
    embed
      .setColor(EMBED_COLORS.DELETE)
      .setTitle("🗑️ Task Cancelled")
      .setDescription(`Hello! A task assigned to you has been cancelled by <@${actorId}>.`);
  }
  embed.addFields(
    { name: "📋 Task", value: taskData.title || "Unknown", inline: true },
    { name: "🔥 Priority", value: taskData.priority || "Normal", inline: true }
  );
  if (taskData.dueDate) {
    embed.addFields({ name: "📅 Deadline", value: formatTime(taskData.dueDate), inline: false });
  }
  await sendDM(client, externalId, embed);
}

// ===================== 3. Event notifications =====================
async function notifyEvent(client, externalIds, action, eventData, actorId) {
  if (!externalIds || externalIds.length === 0) return;
  const embed = new EmbedBuilder().setTimestamp();
  if (action === "create") {
    embed
      .setColor(EMBED_COLORS.CREATE || EMBED_COLORS.INFO)
      .setTitle("📅 Event Assignment")
      .setDescription(`Hello! You have been assigned to a new event by <@${actorId}>.`);
  } else if (action === "update") {
    embed
      .setColor(EMBED_COLORS.UPDATE || EMBED_COLORS.INFO)
      .setTitle("✏️ Event Update Notification")
      .setDescription(`Hello! An event you are assigned to has been updated by <@${actorId}>.`);
  } else if (action === "delete") {
    embed
      .setColor(EMBED_COLORS.DELETE)
      .setTitle("🗑️ Event Cancelled")
      .setDescription(`Hello! An event you were assigned to has been cancelled by <@${actorId}>.`);
  }
  embed.addFields({ name: "📌 Event", value: eventData.title || "Unknown", inline: true });
  if (eventData.startDate) {
    embed.addFields({ name: "⏰ Starts", value: formatTime(eventData.startDate), inline: false });
  }
  for (const id of externalIds) {
    await sendDM(client, id, embed);
  }
}

// ===================== 4. Workspace channel notifications =====================
async function getSettings(guildId) {
  try {
    return (await getWorkspace(guildId)) ?? {};
  } catch {
    return {};
  }
}

async function notifyScheduleChannel(client, guildId, embed) {
  if (!guildId) return;
  const settings = await getSettings(guildId);
  const channelId = settings.scheduleChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch {
    console.log("⚠️ Could not send notification to schedule channel.");
  }
}

// Falls back to the schedule channel so the log is never lost
async function notifyBillingChannel(client, guildId, embed) {
  if (!guildId) return;
  const settings = await getSettings(guildId);
  const channelId = settings.billingChannelId || settings.scheduleChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch {
    console.log("⚠️ Could not send notification to billing channel.");
  }
}

// ===================== 5. New lead alerts (multi-tenant) =====================
// guildId should come from the API payload (workspace that owns the WhatsApp number).
// The guild-scanning loop is a deprecated fallback for the old single-tenant flow.
async function notifyNewLead(client, lead, guildId = null) {
  let channelId = null;

  if (guildId) {
    const settings = await getSettings(guildId);
    channelId = settings.leadsChannelId;
  } else {
    for (const [gid] of client.guilds.cache) {
      const settings = await getSettings(gid);
      if (settings.leadsChannelId) {
        channelId = settings.leadsChannelId;
        break;
      }
    }
  }

  if (!channelId) return; // no leads channel configured — stay silent

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.CREATE || EMBED_COLORS.INFO)
    .setTitle("🟢 New WhatsApp Lead")
    .addFields(
      { name: "👤 Name", value: lead.name || "Unknown", inline: true },
      { name: "📱 Phone", value: lead.phone || "N/A", inline: true }
    )
    .setTimestamp();

  if (lead.message) {
    const text = String(lead.message);
    embed.addFields({
      name: "💬 Message",
      value: text.length > 300 ? text.slice(0, 300) + "..." : text,
      inline: false,
    });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (error) {
    console.log("[Notify] Could not send to leads channel:", error.message);
  }
}

// ===================== 6. Reminder notifications =====================
async function notifyReminder(client, externalId, type, itemData, timeRemaining) {
  const embed = new EmbedBuilder().setColor(EMBED_COLORS.WARNING || "#FFA500").setTimestamp();
  let title, itemName, itemTime;

  if (type === "Task") {
    embed.setTitle("⏰ Task deadline approaching");
    title = "📋 Task";
    itemName = itemData.title || "Unknown";
    itemTime = itemData.dueDate;
  } else if (type === "Appointment") {
    embed.setTitle("⏰ Appointment starting soon");
    title = "📅 Appointment";
    itemName = itemData.title || itemData.subject || "Unknown";
    itemTime = itemData.startTime;
  } else if (type === "Event") {
    embed.setTitle("⏰ Event starting soon");
    title = "📅 Event";
    itemName = itemData.title || "Unknown";
    itemTime = itemData.startDate;
  }

  embed.addFields(
    { name: title, value: itemName, inline: true },
    { name: "⏳ Time remaining", value: String(timeRemaining), inline: true },
    { name: "📅 Scheduled", value: formatTime(itemTime), inline: false }
  );
  await sendDM(client, externalId, embed);
}

module.exports = {
  notifyAppointment,
  notifyClass, // deprecated alias
  notifyTask,
  notifyEvent,
  notifyScheduleChannel,
  notifyBillingChannel,
  notifyReminder,
  notifyNewLead,
};
