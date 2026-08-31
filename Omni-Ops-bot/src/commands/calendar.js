const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const axios = require("../utils/axiosInstance");
const { clearCache } = require("../utils/cache");
const EMBED_COLORS = require("../utils/embedColors");
const { parseLocalDateTime, isValidYear, parseSeriesDates } = require("../utils/dateParser");
const { notifyEvent, notifyScheduleChannel } = require("../utils/dmNotifier");
const { checkScheduleConflict } = require("../utils/conflictChecker");
const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
const { requireRole, MANAGEMENT_ROLES } = require("../utils/requireRole");

const TYPE_CHOICES = [
  { name: "🤝 Meeting", value: "meeting" },
  { name: "⏳ Deadline", value: "deadline" },
  { name: "🏆 Milestone", value: "milestone" },
  { name: "🛠️ Workshop", value: "workshop" },
  { name: "🎈 Social", value: "social" },
  { name: "📅 Other", value: "event" },
];
const typeLabels = {
  meeting: "Meeting",
  deadline: "Deadline",
  milestone: "Milestone",
  workshop: "Workshop",
  social: "Social",
  event: "Other",
};

// Parses the scope input: 'this'/'single', 'all'/'series', or explicit dates like '10,14/7'
function parseScope(scopeInput) {
  const s = scopeInput.trim().toLowerCase();
  if (["all", "series"].includes(s)) return { scope: "series" };
  if (["this", "single"].includes(s)) return { scope: "single" };
  const parsedDates = parseSeriesDates(s);
  if (!parsedDates || parsedDates.length === 0) {
    return { error: "❌ Invalid scope format. Type 'this', 'all', or dates like '10,15/7'." };
  }
  return { scope: parsedDates.join(",") };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("calendar")
    .setDescription("Manage organization events and calendar")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new event")
        .addStringOption((option) =>
          option.setName("title").setDescription("Event title").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Event type")
            .setRequired(true)
            .addChoices(...TYPE_CHOICES)
        )
        .addStringOption((option) =>
          option
            .setName("dates")
            .setDescription("Dates (DD-DD/MM, 12-20 or 15/8)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("Start time (e.g., 2:30 pm)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("end_time").setDescription("End time (e.g., 4:00 pm)").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Event description").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("assigned")
            .setDescription("Mention users responsible for this event (e.g., @Khaled @Ali)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List upcoming events"))
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing event")
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Select the event to edit")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Scope: 'this', 'all', or dates like '10,16/7'")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("title").setDescription("New event title").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("New event type")
            .setRequired(false)
            .addChoices(...TYPE_CHOICES)
        )
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("Start time (e.g., 2:30 pm)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("end_time").setDescription("End time (e.g., 4:00 pm)").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("New description").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("assigned").setDescription("New assignees (mentions)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete an event")
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Select event")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Scope: 'this', 'all', or dates like '10,16/7'")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("Sync employee emails from database to Google Calendar")
    )
    .addSubcommand((sub) =>
      sub
        .setName("sync-sheet")
        .setDescription("📊 Export all existing appointments & events to the accounting sheet")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // ========================= CREATE =========================
      if (subcommand === "create") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;
        const title = interaction.options.getString("title");
        const type = interaction.options.getString("type");
        const datesInput = interaction.options.getString("dates");
        const startTimeInput = interaction.options.getString("start_time");
        const endTimeInput = interaction.options.getString("end_time");
        const description = interaction.options.getString("description");
        const assigned = interaction.options.getString("assigned");

        const datesList = parseSeriesDates(datesInput);
        if (!datesList || datesList.length === 0) {
          return interaction.editReply(
            "❌ Invalid dates format. Use formats like '12-20' or '15/8'."
          );
        }

        let externalIds = [];
        if (assigned) {
          const mentionRegex = /<@!?(\d+)>/g;
          let match;
          while ((match = mentionRegex.exec(assigned)) !== null) externalIds.push(match[1]);
        }

        let assigneeIds = [];
        if (externalIds.length > 0) {
          try {
            const employeesRes = await axios.get(`/employees`);
            assigneeIds = employeesRes.data
              .filter((emp) => externalIds.includes(emp.externalId))
              .map((emp) => emp.id);
          } catch (err) {}
        }

        // Replace mentions with display names for storage in the description
        let plainNamesAssigned = assigned;
        if (assigned) {
          const mentionRegex = /<@!?(\d+)>/g;
          let match;
          while ((match = mentionRegex.exec(assigned)) !== null) {
            try {
              const member = await interaction.guild.members.fetch(match[1]);
              plainNamesAssigned = plainNamesAssigned.replace(match[0], `@${member.displayName}`);
            } catch (err) {}
          }
        }

        let dbDescription = `🏷️ Type: ${typeLabels[type] || type}\n`;
        if (description) dbDescription += `📄 Details: ${description}\n`;
        if (plainNamesAssigned) dbDescription += `👥 Assigned To: ${plainNamesAssigned}`;

        const eventsArray = [];
        for (const dateStr of datesList) {
          const startResult = parseLocalDateTime(dateStr, startTimeInput);
          if (!startResult) continue;
          let endDate;
          if (startResult.isAllDay) {
            endDate = new Date(startResult.date);
          } else {
            if (endTimeInput) {
              const endResult = parseLocalDateTime(dateStr, endTimeInput);
              endDate = endResult
                ? endResult.date
                : new Date(startResult.date.getTime() + 60 * 60 * 1000);
            } else {
              endDate = new Date(startResult.date.getTime() + 60 * 60 * 1000);
            }
          }
          if (!isValidYear(startResult.date)) continue;
          if (!startResult.isAllDay && endDate <= startResult.date) continue;
          if (externalIds.length > 0) {
            const conflict = await checkScheduleConflict(
              interaction,
              externalIds,
              startResult.date,
              endDate
            );
            if (conflict) {
              return interaction.editReply(
                `⚠️ Schedule Conflict for ${conflict.conflictedUser} on ${dateStr}. Time: ${conflict.time}`
              );
            }
          }
          eventsArray.push({
            title,
            type,
            startDate: startResult.date,
            endDate,
            isAllDay: startResult.isAllDay,
            description: dbDescription,
            createdById: manager.id,
            assigneeIds,
          });
        }
        if (eventsArray.length === 0)
          return interaction.editReply("❌ No valid dates could be processed.");

        const bulkRes = await axios.post(`/calendar/events/bulk`, {
          events: eventsArray,
        });
        clearCache("events_list");

        // One DM per assigned employee for the whole series (not one per day)
        const firstCreated = bulkRes.data?.created?.[0];
        if (firstCreated && externalIds.length > 0) {
          await notifyEvent(
            interaction.client,
            externalIds,
            "create",
            firstCreated,
            interaction.user.id
          );
        }

        const firstEvent = eventsArray[0];
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.CREATE)
          .setTitle(`✅ Created ${eventsArray.length} Event(s) Successfully`)
          .addFields(
            { name: "📌 Title", value: title, inline: true },
            { name: "🏷️ Type", value: typeLabels[type] || type, inline: true },
            {
              name: "📅 First Day",
              value: `<t:${Math.floor(firstEvent.startDate.getTime() / 1000)}:F>`,
              inline: false,
            }
          )
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
      }
      // ========================= LIST =========================
      else if (subcommand === "list") {
        const response = await axios.get(`/calendar/events`);
        const events = response.data;
        const upcomingEvents = events.filter((e) => new Date(e.endDate) > new Date());
        if (!upcomingEvents.length) return interaction.editReply("📭 No upcoming events found.");
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle("📅 Upcoming Events")
          .setTimestamp();
        upcomingEvents.slice(0, 10).forEach((event) => {
          const startTime = Math.floor(new Date(event.startDate).getTime() / 1000);
          embed.addFields({
            name: `${event.title} (${event.type})`,
            value: `⏰ <t:${startTime}:f>\n👤 Created by: ${event.createdBy?.name || "System"}`,
            inline: false,
          });
        });
        await interaction.editReply({ embeds: [embed] });
      }
      // ========================= EDIT =========================
      else if (subcommand === "edit") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;
        const eventId = interaction.options.getString("event");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
          return interaction.editReply("❌ Please select from the dropdown.");
        }
        const scopeResult = parseScope(interaction.options.getString("scope"));
        if (scopeResult.error) return interaction.editReply(scopeResult.error);
        const scope = scopeResult.scope;

        const title = interaction.options.getString("title");
        const type = interaction.options.getString("type");
        const startTimeInput = interaction.options.getString("start_time");
        const endTimeInput = interaction.options.getString("end_time");
        const description = interaction.options.getString("description");
        const assigned = interaction.options.getString("assigned");

        const eventToEditResponse = await axios.get(`/calendar/events`);
        const existingEvent = eventToEditResponse.data.find((e) => e.id === eventId);
        if (!existingEvent) return interaction.editReply("❌ Event not found.");

        const updateData = {};
        if (title) updateData.title = title;
        if (type) updateData.type = type;
        if (startTimeInput) updateData.startTime = startTimeInput;
        if (endTimeInput) updateData.endTime = endTimeInput;

        // Preserve the free-text part of the old description
        let oldCleanDesc = "";
        if (existingEvent.description) {
          const match = existingEvent.description.match(/📄 Details: (.*?)(?=\n👥|$)/s);
          if (match) oldCleanDesc = match[1].trim();
        }

        let dbDescription = `🏷️ Type: ${typeLabels[type || existingEvent.type] || type || existingEvent.type}\n`;
        const newDesc = description !== null ? description : oldCleanDesc;
        if (newDesc) dbDescription += `📄 Details: ${newDesc}\n`;

        if (assigned) {
          let plainNamesAssigned = assigned;
          const mentionRegex = /<@!?(\d+)>/g;
          let match;
          let externalIds = [];
          while ((match = mentionRegex.exec(assigned)) !== null) {
            externalIds.push(match[1]);
            try {
              const member = await interaction.guild.members.fetch(match[1]);
              plainNamesAssigned = plainNamesAssigned.replace(match[0], `@${member.displayName}`);
            } catch (err) {}
          }
          dbDescription += `👥 Assigned To: ${plainNamesAssigned}`;
          const employeesRes = await axios.get(`/employees`);
          updateData.assigneeIds = employeesRes.data
            .filter((emp) => externalIds.includes(emp.externalId))
            .map((emp) => emp.id);
        } else if (
          existingEvent.description &&
          existingEvent.description.includes("👥 Assigned To:")
        ) {
          const oldAssigned = existingEvent.description.split("👥 Assigned To:")[1].trim();
          dbDescription += `👥 Assigned To: ${oldAssigned}`;
        }
        updateData.description = dbDescription;

        if (!title && !type && !startTimeInput && !endTimeInput && !description && !assigned) {
          return interaction.editReply("⚠️ No changes provided.");
        }

        const updRes = await axios.patch(
          `/calendar/events/${eventId}?scope=${scope}`,
          updateData
        );
        clearCache("events_list");

        // One DM per affected employee, even if multiple days changed
        const affected = updRes.data?.events || [];
        const notifiedIds = new Set();
        for (const ev of affected) {
          for (const a of ev.assignees || []) {
            if (a.externalId && !notifiedIds.has(a.externalId)) {
              notifiedIds.add(a.externalId);
              await notifyEvent(
                interaction.client,
                [a.externalId],
                "update",
                ev,
                interaction.user.id
              );
            }
          }
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE)
          .setTitle(`✏️ Event(s) Updated — ${updRes.data?.count || 1} day(s)`)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
      }
      // ========================= SYNC ACCESS =========================
      else if (subcommand === "sync") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;
        await interaction.editReply(
          "⏳ Syncing DB emails with Google Calendar... This might take a minute."
        );
        try {
          await axios.post(`/calendar/sync`);
          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.SUCCESS || EMBED_COLORS.INFO)
            .setTitle("✅ Calendar Sync Complete")
            .setDescription(
              `Successfully synced employee emails to Google Calendar.\n\nAll registered employees now have **View Only** access.`
            )
            .setTimestamp();
          await interaction.editReply({ content: "", embeds: [embed] });
        } catch (error) {
          await interaction.editReply(
            `❌ Failed to sync: ${error.response?.data?.error || error.message}`
          );
        }
      }
      // ========================= SYNC ACCOUNTING SHEET =========================
      else if (subcommand === "sync-sheet") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;
        await interaction.editReply(
          "⏳ Exporting all existing appointments & events to the accounting sheet... This might take a minute."
        );
        const response = await axios.post(`/calendar/accounting/backfill`);
        const apptCount = response.data.appointments ?? response.data.classes ?? 0;
        const eventCount = response.data.events ?? 0;
        const rowsAdded = response.data.rowsAdded ?? 0;
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || EMBED_COLORS.INFO)
          .setTitle("📊 Accounting Sheet Sync Complete")
          .setDescription(
            `Scanned **${apptCount}** appointments and **${eventCount}** events.\n` +
              (rowsAdded > 0
                ? `✅ Added **${rowsAdded}** new rows to the sheet.`
                : `ℹ️ Everything was already in the sheet — nothing to add.`)
          )
          .setFooter({ text: `Requested by ${manager.name}` })
          .setTimestamp();
        await interaction.editReply({ content: "", embeds: [embed] });
      }
      // ========================= DELETE =========================
      else if (subcommand === "delete") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;
        const eventId = interaction.options.getString("event");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
          return interaction.editReply("❌ Please select from the dropdown.");
        }
        const scopeResult = parseScope(interaction.options.getString("scope"));
        if (scopeResult.error) return interaction.editReply(scopeResult.error);
        const scope = scopeResult.scope;

        const delRes = await axios.delete(
          `/calendar/events/${eventId}?scope=${scope}`
        );
        clearCache("events_list");

        const affected = delRes.data?.events || [];
        const notifiedIds = new Set();
        for (const ev of affected) {
          for (const a of ev.assignees || []) {
            if (a.externalId && !notifiedIds.has(a.externalId)) {
              notifiedIds.add(a.externalId);
              await notifyEvent(
                interaction.client,
                [a.externalId],
                "delete",
                ev,
                interaction.user.id
              );
            }
          }
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle(`🗑️ Event(s) Deleted — ${delRes.data?.count || 1} day(s)`)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
    }
  },

  async autocomplete(interaction) {
    await handleGlobalAutocomplete(interaction);
  },
};
