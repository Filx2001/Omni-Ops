const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const axios = require("../utils/axiosInstance");
const { clearCache } = require("../utils/cache");
const EMBED_COLORS = require("../utils/embedColors");
const { parseQatarDateTime, isValidYear, parseSeriesDates } = require("../utils/dateParser"); // Note: You may want to rename parseQatarDateTime to parseLocalDateTime later
const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
const { requireRole, MANAGEMENT_ROLES } = require("../utils/requireRole");
const { notifyAppointment, notifyScheduleChannel } = require("../utils/dmNotifier"); // Note: renamed from notifyClass
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WEEKDAYS = [
  { name: "Sunday", value: "Sunday" },
  { name: "Monday", value: "Monday" },
  { name: "Tuesday", value: "Tuesday" },
  { name: "Wednesday", value: "Wednesday" },
  { name: "Thursday", value: "Thursday" },
  { name: "Friday", value: "Friday" },
  { name: "Saturday", value: "Saturday" },
];

const checkSmartOverlap = (newStart, newEnd, existStart, existEnd) => {
  const dNewStart = new Date(newStart);
  const dNewEnd = new Date(newEnd);
  const dExistStart = new Date(existStart);
  const dExistEnd = new Date(existEnd);

  const newStartDate = new Date(dNewStart).setHours(0, 0, 0, 0);
  const newEndDate = new Date(dNewEnd).setHours(23, 59, 59, 999);
  const existStartDate = new Date(dExistStart).setHours(0, 0, 0, 0);
  const existEndDate = new Date(dExistEnd).setHours(23, 59, 59, 999);

  if (!(newStartDate <= existEndDate && newEndDate >= existStartDate)) return false;

  const getMinutes = (d) => d.getHours() * 60 + d.getMinutes();
  const newStartMins = getMinutes(dNewStart);
  const newEndMins = getMinutes(dNewEnd);
  const existStartMins = getMinutes(dExistStart);
  const existEndMins = getMinutes(dExistEnd);

  return newStartMins < existEndMins && newEndMins > existStartMins;
};

const appointmentLabel = (a) => {
  if (a.title) return a.title;
  const d = new Date(a.startTime);
  return `${a.assignee?.name || "TBA"} Appointment - ${d.getDate()}/${d.getMonth() + 1}`;
};

const timeFields = (a) => {
  if (a.isAllDay) {
    return [{ name: "⏰ Time", value: "All day (no time set)", inline: true }];
  }
  return [
    {
      name: "⏰ Starts",
      value: `<t:${Math.floor(new Date(a.startTime).getTime() / 1000)}:t>`,
      inline: true,
    },
    {
      name: "🏁 Ends",
      value: `<t:${Math.floor(new Date(a.endTime).getTime() / 1000)}:t>`,
      inline: true,
    },
  ];
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("appointment")
    .setDescription("Manage appointments and schedules")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Schedule a new appointment")
        .addStringOption((option) =>
          option
            .setName("assignee")
            .setDescription("Select the staff member / assignee")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Single: DD/MM, today, tomorrow — or 🔁 Repeat: 1-15 • 1,3,7 • 1-15/8")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Appointment title (optional — auto-named if left empty)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("Start time, e.g. 2:30 pm (optional — all-day if left empty)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("end_time")
            .setDescription("End time, e.g. 4:00 pm (optional)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("day")
            .setDescription("Day of the week (optional — taken from the date)")
            .setRequired(false)
            .addChoices(...WEEKDAYS)
        )
        .addStringOption((option) =>
          option
            .setName("location")
            .setDescription("Location, Room, or Meeting Link")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("View the appointment schedule"))
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing appointment")
        .addStringOption((option) =>
          option
            .setName("appointment")
            .setDescription("Select the appointment to edit")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("title").setDescription("New title").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("day")
            .setDescription("New day")
            .setRequired(false)
            .addChoices(...WEEKDAYS)
        )
        .addStringOption((option) =>
          option.setName("date").setDescription("New date (e.g. DD/MM)").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("New start time (e.g. 2:30 pm)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("end_time")
            .setDescription("New end time (e.g. 4:00 pm)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("assignee")
            .setDescription("New assignee")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("location").setDescription("New location or link").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Apply to this appointment only or the whole repeated series")
            .setRequired(false)
            .addChoices(
              { name: "This appointment only", value: "this" },
              { name: "Whole series 🔁", value: "series" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Remove an appointment from the schedule")
        .addStringOption((option) =>
          option
            .setName("appointment")
            .setDescription("Select the appointment to delete")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Delete this appointment only or the whole series")
            .setRequired(false)
            .addChoices(
              { name: "This appointment only", value: "this" },
              { name: "Whole series 🔁", value: "series" }
            )
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (subcommand === "add") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;

        const title = interaction.options.getString("title") || null;
        const dayInput = interaction.options.getString("day");
        const dateInput = interaction.options.getString("date");
        const startTimeInput = interaction.options.getString("start_time");
        const endTimeInput = interaction.options.getString("end_time");
        const assigneeId = interaction.options.getString("assignee");
        const location = interaction.options.getString("location") || null;

        if (!uuidRegex.test(assigneeId)) {
          return interaction.editReply(
            "❌ Please select the assignee from the **autocomplete dropdown menu**."
          );
        }

        const isAllDay = !startTimeInput;

        if (!isAllDay && !endTimeInput) {
          return interaction.editReply(
            "❌ Please provide an end time as well, or leave both empty for an all-day appointment."
          );
        }

        const appointmentsResponse = await axios.get(
          `${process.env.API_URL}/calendar/appointments`
        );
        const existingAppointments = appointmentsResponse.data;

        const isSeries = /[,\-]/.test(dateInput);

        if (isSeries) {
          const dateStrings = parseSeriesDates(dateInput);
          if (!dateStrings) {
            return interaction.editReply(
              "❌ Invalid `date` format. Examples: `5/8` • `today` • `1-15` • `1,3,7` • `1-15/8` • `1,3,7/8/2026`"
            );
          }

          const assigneeAppointmentsAll = existingAppointments.filter(
            (a) => a.assigneeId === assigneeId
          );
          const valid = [];
          const skipped = [];

          for (const dStr of dateStrings) {
            const sRes = parseQatarDateTime(dStr, startTimeInput); // Consider renaming this utility function later
            const eRes = parseQatarDateTime(dStr, endTimeInput || startTimeInput);

            if (!sRes || !eRes) {
              skipped.push(`${dStr} (invalid date)`);
              continue;
            }

            const s = sRes.date;
            const e = eRes.date;

            if (!isAllDay) {
              if (e <= s) {
                return interaction.editReply("❌ The end time must be after the start time.");
              }
              const durH = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
              if (durH > 24) {
                return interaction.editReply(
                  "❌ A single timed appointment cannot exceed 24 hours."
                );
              }
            }

            if (!isValidYear(s)) {
              skipped.push(`${dStr} (too far in the past)`);
              continue;
            }

            if (!isAllDay) {
              const conflict = assigneeAppointmentsAll.some(
                (a) => !a.isAllDay && checkSmartOverlap(s, e, a.startTime, a.endTime)
              );
              if (conflict) {
                skipped.push(`${dStr} (conflict)`);
                continue;
              }
            }

            valid.push({
              title,
              day: dayInput || s.toLocaleDateString("en-US", { weekday: "long" }), // Removed hardcoded timezone
              startTime: s,
              endTime: isAllDay ? s : e,
              isAllDay,
              assigneeId,
              location,
              createdById: manager.id,
            });
          }

          if (!valid.length) {
            return interaction.editReply(
              `❌ No appointments could be scheduled.\n⏭️ Skipped: ${skipped.join(", ")}`
            );
          }

          const bulkRes = await axios.post(`${process.env.API_URL}/calendar/appointments/bulk`, {
            appointments: valid,
          });

          clearCache("appointments_list");

          const created = bulkRes.data.created || [];
          const apiFailed = (bulkRes.data.failed || []).map(
            (f) => `${new Date(f.startTime).toLocaleDateString("en-GB")} (${f.error})`
          );
          const allSkipped = [...skipped, ...apiFailed];

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.CREATE)
            .setTitle("🔁 Appointment Series Scheduled")
            .addFields(
              {
                name: "📅 Title",
                value: created[0] ? appointmentLabel(created[0]) : title || "Auto-named",
                inline: true,
              },
              { name: "👤 Assignee", value: created[0]?.assignee?.name || "Unknown", inline: true },
              { name: "📍 Location", value: location || "TBA", inline: true },
              { name: "✅ Scheduled", value: `${created.length} appointments`, inline: true },
              ...(created[0] ? timeFields(created[0]) : []),
              ...(allSkipped.length
                ? [{ name: "⏭️ Skipped", value: allSkipped.join("\n").substring(0, 1024) }]
                : [])
            )
            .setFooter({ text: `Added by ${manager.name}` })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });

          if (created[0]?.assignee?.externalId) {
            await notifyAppointment(
              interaction.client,
              created[0].assignee.externalId,
              "create",
              created[0],
              interaction.user.id
            );
          }
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
          return;
        }

        const startResult = parseQatarDateTime(dateInput, startTimeInput);
        const endResult = parseQatarDateTime(dateInput, endTimeInput || startTimeInput);

        if (!startResult || !endResult) {
          return interaction.editReply("❌ Invalid date/time format.");
        }

        const startTime = startResult.date;
        const endTime = isAllDay ? startResult.date : endResult.date;

        if (!isValidYear(startTime)) {
          return interaction.editReply(
            "❌ You cannot schedule an appointment that far in the past."
          );
        }

        if (!isAllDay) {
          if (endTime <= startTime) {
            return interaction.editReply("❌ The end time must be after the start time.");
          }
          const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
          if (durationHours > 24) {
            return interaction.editReply("❌ A single timed appointment cannot exceed 24 hours.");
          }

          const assigneeAppointments = existingAppointments.filter(
            (a) => a.assigneeId === assigneeId && !a.isAllDay
          );

          const hasConflict = assigneeAppointments.some((a) =>
            checkSmartOverlap(startTime, endTime, a.startTime, a.endTime)
          );

          if (hasConflict) {
            const conflictEmbed = new EmbedBuilder()
              .setColor(EMBED_COLORS.DELETE)
              .setTitle("⚠️ Schedule Conflict")
              .setDescription(
                `**Assignee:** <@${assigneeId}>\nThis staff member already has another appointment that overlaps with this time.`
              )
              .setTimestamp();
            return interaction.editReply({ embeds: [conflictEmbed] });
          }
        }

        const response = await axios.post(`${process.env.API_URL}/calendar/appointments`, {
          title,
          day: dayInput || null,
          startTime,
          endTime,
          isAllDay,
          assigneeId,
          location,
          createdById: manager.id,
        });

        clearCache("appointments_list");
        const created = response.data;

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.CREATE)
          .setTitle("📅 New Appointment Scheduled")
          .addFields(
            { name: "📅 Title", value: appointmentLabel(created), inline: true },
            { name: "👤 Assignee", value: created.assignee?.name || "Unknown", inline: true },
            { name: "📍 Location", value: created.location || "TBA", inline: true },
            { name: "🗓️ Day", value: created.day || "-", inline: true },
            ...timeFields(created)
          )
          .setFooter({ text: `Added by ${manager.name}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (created.assignee?.externalId) {
          await notifyAppointment(
            interaction.client,
            created.assignee.externalId,
            "create",
            created,
            interaction.user.id
          );
        }
        await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
      } else if (subcommand === "list") {
        const response = await axios.get(`${process.env.API_URL}/calendar/appointments`);
        const appointments = response.data;

        const upcomingAppointments = appointments.filter((a) => new Date(a.endTime) > new Date());

        if (!upcomingAppointments.length) {
          return interaction.editReply("📭 No upcoming appointments scheduled.");
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle("📅 Upcoming Appointment Schedule")
          .setTimestamp();

        upcomingAppointments.slice(0, 10).forEach((a) => {
          const startTimestamp = Math.floor(new Date(a.startTime).getTime() / 1000);
          const endTimestamp = Math.floor(new Date(a.endTime).getTime() / 1000);
          const assigneeName = a.assignee?.name || "No assignee";
          const timeLine = a.isAllDay
            ? `📆 <t:${startTimestamp}:D> · All day`
            : `⏰ <t:${startTimestamp}:f> to <t:${endTimestamp}:t>`;

          embed.addFields({
            name: `📅 ${appointmentLabel(a)}${a.day ? ` (${a.day})` : ""}`,
            value: `👤 **Assignee:** ${assigneeName}\n📍 **Location:** ${a.location || "TBA"}\n${timeLine}`,
            inline: false,
          });
        });

        await interaction.editReply({ embeds: [embed] });
      } else if (subcommand === "edit") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;

        const appointmentId = interaction.options.getString("appointment");
        const title = interaction.options.getString("title");
        const day = interaction.options.getString("day");
        const dateInput = interaction.options.getString("date");
        const startTimeInput = interaction.options.getString("start_time");
        const endTimeInput = interaction.options.getString("end_time");
        const assigneeId = interaction.options.getString("assignee");
        const location = interaction.options.getString("location");

        if (assigneeId && !uuidRegex.test(assigneeId)) {
          return interaction.editReply(
            "❌ Please select the assignee from the **autocomplete dropdown menu**."
          );
        }

        const apptToEditResponse = await axios.get(`${process.env.API_URL}/calendar/appointments`);
        const existingAppointments = apptToEditResponse.data;
        const apptToEdit = existingAppointments.find((a) => a.id === appointmentId);

        if (!apptToEdit) return interaction.editReply("❌ Appointment not found.");

        const updateData = {};
        if (title) updateData.title = title;
        if (day) updateData.day = day;
        if (assigneeId) updateData.assigneeId = assigneeId;
        if (location) updateData.location = location;

        let startTime, endTime;

        const becomingTimed = apptToEdit.isAllDay && startTimeInput && endTimeInput;
        const willBeAllDay = becomingTimed ? false : apptToEdit.isAllDay;

        if (dateInput || startTimeInput || endTimeInput) {
          const origStartObj = new Date(apptToEdit.startTime);
          const origEndObj = new Date(apptToEdit.endTime);

          const formatTime = (d) => {
            let h = d.getHours();
            const m = d.getMinutes();
            const ampm = h >= 12 ? "pm" : "am";
            h = h % 12 || 12;
            return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
          };

          const fallbackDateStr =
            dateInput ||
            `${origStartObj.getDate()}/${origStartObj.getMonth() + 1}/${origStartObj.getFullYear()}`;
          const fallbackStartStr = startTimeInput || formatTime(origStartObj);
          const fallbackEndStr = endTimeInput || formatTime(origEndObj);

          const startResult = parseQatarDateTime(fallbackDateStr, fallbackStartStr);
          const endResult = parseQatarDateTime(fallbackDateStr, fallbackEndStr);

          if (!startResult || !endResult) {
            return interaction.editReply("❌ Invalid date/time format.");
          }

          startTime = startResult.date;
          endTime = willBeAllDay ? startResult.date : endResult.date;

          if (!isValidYear(startTime)) {
            return interaction.editReply(
              "❌ You cannot move an appointment that far into the past."
            );
          }

          updateData.startTime = startTime;
          updateData.endTime = endTime;
          if (becomingTimed) updateData.isAllDay = false;
        }

        const finalStartTime = startTime || new Date(apptToEdit.startTime);
        const finalEndTime = endTime || new Date(apptToEdit.endTime);
        const finalAssigneeId = assigneeId || apptToEdit.assigneeId;

        if (!willBeAllDay) {
          if (finalEndTime <= finalStartTime) {
            return interaction.editReply("❌ The end time must be after the start time.");
          }
          const durationHours =
            (finalEndTime.getTime() - finalStartTime.getTime()) / (1000 * 60 * 60);
          if (durationHours > 24) {
            return interaction.editReply("❌ A single timed appointment cannot exceed 24 hours.");
          }

          const assigneeAppointments = existingAppointments.filter(
            (a) => a.assigneeId === finalAssigneeId && a.id !== appointmentId && !a.isAllDay
          );

          const hasConflict = assigneeAppointments.some((a) =>
            checkSmartOverlap(finalStartTime, finalEndTime, a.startTime, a.endTime)
          );

          if (hasConflict) {
            const conflictEmbed = new EmbedBuilder()
              .setColor(EMBED_COLORS.DELETE)
              .setTitle("⚠️ Schedule Conflict")
              .setDescription(
                `**Assignee:** <@${finalAssigneeId}>\nThis staff member already has another appointment that overlaps with the new time.`
              )
              .setTimestamp();
            return interaction.editReply({ embeds: [conflictEmbed] });
          }
        }

        if (Object.keys(updateData).length === 0) {
          return interaction.editReply("⚠️ Please provide at least one field to update.");
        }

        const scope = interaction.options.getString("scope") || "this";

        if (scope === "series" && apptToEdit.groupId) {
          if (dateInput) {
            return interaction.editReply(
              "❌ You can't change the **date** for a whole series (each appointment has its own day). Edit dates one by one."
            );
          }

          const groupAppointments = existingAppointments.filter(
            (a) => a.groupId === apptToEdit.groupId
          );
          const outsideGroup = existingAppointments.filter((a) => a.groupId !== apptToEdit.groupId);

          let updatedCount = 0;
          const seriesSkipped = [];

          for (const appt of groupAppointments) {
            const apptUpdate = { ...updateData };
            delete apptUpdate.day;

            if (startTimeInput || endTimeInput) {
              const o = new Date(appt.startTime);
              const oe = new Date(appt.endTime);
              const dStr = `${o.getDate()}/${o.getMonth() + 1}/${o.getFullYear()}`;

              const fmt = (d) => {
                let h = d.getHours();
                const mm = d.getMinutes();
                const ap = h >= 12 ? "pm" : "am";
                h = h % 12 || 12;
                return `${h}:${mm.toString().padStart(2, "0")} ${ap}`;
              };

              const sR = parseQatarDateTime(dStr, startTimeInput || fmt(o));
              const eR = parseQatarDateTime(dStr, endTimeInput || fmt(oe));

              if (!sR || !eR) {
                seriesSkipped.push(`${dStr} (invalid time)`);
                continue;
              }

              apptUpdate.startTime = sR.date;
              apptUpdate.endTime = eR.date;
              if (appt.isAllDay && startTimeInput && endTimeInput) apptUpdate.isAllDay = false;
            }

            const fs = apptUpdate.startTime || new Date(appt.startTime);
            const fe = apptUpdate.endTime || new Date(appt.endTime);
            const ft = apptUpdate.assigneeId || appt.assigneeId;
            const stillAllDay = apptUpdate.isAllDay === false ? false : appt.isAllDay;

            if (!stillAllDay) {
              const conflict = outsideGroup.some(
                (a) =>
                  a.assigneeId === ft &&
                  !a.isAllDay &&
                  checkSmartOverlap(fs, fe, a.startTime, a.endTime)
              );
              if (conflict) {
                seriesSkipped.push(
                  `${new Date(appt.startTime).toLocaleDateString("en-GB")} (conflict)`
                );
                continue;
              }
            }

            await axios.patch(
              `${process.env.API_URL}/calendar/appointments/${appt.id}`,
              apptUpdate
            );
            updatedCount++;
          }

          clearCache("appointments_list");

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.UPDATE || EMBED_COLORS.INFO)
            .setTitle("🔁 Series Updated")
            .setDescription(
              `✅ Updated **${updatedCount}** appointments in the series.` +
                (seriesSkipped.length ? `\n⏭️ Skipped: ${seriesSkipped.join(", ")}` : "")
            )
            .setFooter({ text: `Updated by ${manager.name}` })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
          return;
        }

        if (assigneeId && assigneeId !== apptToEdit.assigneeId && apptToEdit.groupId) {
          updateData.groupId = null;
        }

        const response = await axios.patch(
          `${process.env.API_URL}/calendar/appointments/${appointmentId}`,
          updateData
        );

        clearCache("appointments_list");
        const updated = response.data;

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE || EMBED_COLORS.INFO)
          .setTitle("✏️ Appointment Updated Successfully")
          .addFields(
            { name: "📅 Title", value: appointmentLabel(updated), inline: true },
            { name: "👤 Assignee", value: updated.assignee?.name || "Unknown", inline: true },
            { name: "📍 Location", value: updated.location || "TBA", inline: true },
            { name: "🗓️ Day", value: updated.day || "-", inline: true },
            ...timeFields(updated)
          )
          .setFooter({ text: `Updated by ${manager.name}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (updated.assignee?.externalId) {
          await notifyAppointment(
            interaction.client,
            updated.assignee.externalId,
            "update",
            updated,
            interaction.user.id
          );
        }
        await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
      } else if (subcommand === "delete") {
        const manager = await requireRole(interaction, MANAGEMENT_ROLES);
        if (!manager) return;

        const cleanId = interaction.options.getString("appointment").trim();
        if (!uuidRegex.test(cleanId)) {
          return interaction.editReply(
            "❌ Please select the appointment from the **autocomplete dropdown menu**."
          );
        }

        const scope = interaction.options.getString("scope") || "this";

        if (scope === "series") {
          const allAppointments = (await axios.get(`${process.env.API_URL}/calendar/appointments`))
            .data;
          const target = allAppointments.find((a) => a.id === cleanId);

          if (!target) return interaction.editReply("❌ Appointment not found.");

          if (!target.groupId) {
            return interaction.editReply(
              "ℹ️ This appointment is not part of a series — use scope **This appointment only**."
            );
          }

          const groupAppointments = allAppointments.filter((a) => a.groupId === target.groupId);

          for (const appt of groupAppointments) {
            await axios.delete(`${process.env.API_URL}/calendar/appointments/${appt.id}`);
          }

          clearCache("appointments_list");

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.DELETE)
            .setTitle("🗑️ Series Deleted")
            .setDescription(
              `Removed **${groupAppointments.length}** appointments (${appointmentLabel(target)}) from the schedule.`
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });

          if (target.assignee?.externalId) {
            await notifyAppointment(
              interaction.client,
              target.assignee.externalId,
              "delete",
              target,
              interaction.user.id
            );
          }
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
          return;
        }

        const response = await axios.delete(
          `${process.env.API_URL}/calendar/appointments/${cleanId}`
        );
        clearCache("appointments_list");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("🗑️ Appointment Deleted")
          .setDescription("The appointment has been removed from the schedule.")
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (response.data.assignee?.externalId) {
          await notifyAppointment(
            interaction.client,
            response.data.assignee.externalId,
            "delete",
            response.data,
            interaction.user.id
          );
        }
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
