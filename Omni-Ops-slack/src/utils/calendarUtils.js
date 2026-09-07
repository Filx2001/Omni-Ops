/**
 * Calendar helpers: labels, overlap detection, Block Kit display builders.
 */

const TYPE_LABELS = {
  meeting: "Meeting",
  deadline: "Deadline",
  milestone: "Milestone",
  workshop: "Workshop",
  social: "Social",
  event: "Other",
};

/** Fallback label for untitled appointments. */
function appointmentLabel(a) {
  if (a.title) return a.title;
  const d = new Date(a.startTime);
  return `${a.assignee?.name || "TBA"} Appointment - ${d.getDate()}/${d.getMonth() + 1}`;
}

/** True when two timed intervals overlap on the same day. */
function checkSmartOverlap(newStart, newEnd, existStart, existEnd) {
  const dNewStart = new Date(newStart);
  const dNewEnd = new Date(newEnd);
  const dExistStart = new Date(existStart);
  const dExistEnd = new Date(existEnd);
  const newStartDate = new Date(dNewStart).setHours(0, 0, 0, 0);
  const newEndDate = new Date(dNewEnd).setHours(23, 59, 59, 999);
  const existStartDate = new Date(dExistStart).setHours(0, 0, 0, 0);
  const existEndDate = new Date(dExistEnd).setHours(23, 59, 59, 999);
  if (!(newStartDate <= existEndDate && newEndDate >= existStartDate)) return false;
  const mins = (d) => d.getHours() * 60 + d.getMinutes();
  return mins(dNewStart) < mins(dExistEnd) && mins(dNewEnd) > mins(dExistStart);
}

/** en-GB date, plus time when a time is set. */
function formatWhen(dateValue) {
  const d = new Date(dateValue);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("en-GB")} ${time}`;
}

/** One-line time description for appointments. */
function formatRange(a) {
  if (a.isAllDay) return `📆 ${formatWhen(a.startTime)} · All day`;
  return `⏰ ${formatWhen(a.startTime)} → ${formatWhen(a.endTime)}`;
}

const APPOINTMENT_HEADERS = {
  create: "📅 Appointment Scheduled",
  update: "✏️ Appointment Updated",
  delete: "🗑️ Appointment Deleted",
  view: "📅 Appointment",
};

/** Confirmation blocks for a single appointment. */
function buildAppointmentBlock(appt, action = "view") {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: APPOINTMENT_HEADERS[action] || "📅 Appointment",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📅 Title*\n${appointmentLabel(appt)}` },
        { type: "mrkdwn", text: `*👤 Assignee*\n${appt.assignee?.name || "Unassigned"}` },
        { type: "mrkdwn", text: `*📍 Location*\n${appt.location || "TBA"}` },
        { type: "mrkdwn", text: `*🗓️ Day*\n${appt.day || "-"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: formatRange(appt) } },
  ];
}

const EVENT_HEADERS = {
  create: "✅ Event Created",
  delete: "🗑️ Event Deleted",
  view: "📅 Event",
};

/** Confirmation blocks for a single event. */
function buildEventBlock(ev, action = "view") {
  const assignees = (ev.assignees || []).map((a) => a.name).join(", ") || "None";
  return [
    {
      type: "header",
      text: { type: "plain_text", text: EVENT_HEADERS[action] || "📅 Event", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📌 Title*\n${ev.title}` },
        { type: "mrkdwn", text: `*🏷️ Type*\n${TYPE_LABELS[ev.type] || ev.type}` },
        { type: "mrkdwn", text: `*👥 Assignees*\n${assignees}` },
        {
          type: "mrkdwn",
          text: `*⏰ When*\n${ev.isAllDay ? `📆 ${formatWhen(ev.startDate)} · All day` : `⏰ ${formatWhen(ev.startDate)} → ${formatWhen(ev.endDate)}`}`,
        },
      ],
    },
  ];
}

/** List blocks for upcoming appointments (max 10). */
function buildAppointmentListBlocks(appointments) {
  return [
    { type: "header", text: { type: "plain_text", text: "📅 Upcoming Appointments", emoji: true } },
    ...appointments.slice(0, 10).map((a) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${appointmentLabel(a)}*${a.day ? ` (${a.day})` : ""}\n` +
          `👤 ${a.assignee?.name || "No assignee"} · 📍 ${a.location || "TBA"}\n` +
          formatRange(a),
      },
    })),
  ];
}

/** List blocks for upcoming events (max 10). */
function buildEventListBlocks(events) {
  return [
    { type: "header", text: { type: "plain_text", text: "📅 Upcoming Events", emoji: true } },
    ...events.slice(0, 10).map((e) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${e.title}* (${TYPE_LABELS[e.type] || e.type})\n` +
          `${e.isAllDay ? `📆 ${formatWhen(e.startDate)} · All day` : `⏰ ${formatWhen(e.startDate)} → ${formatWhen(e.endDate)}`}\n` +
          `👤 Created by ${e.createdBy?.name || "System"}`,
      },
    })),
  ];
}

module.exports = {
  TYPE_LABELS,
  appointmentLabel,
  checkSmartOverlap,
  formatWhen,
  formatRange,
  buildAppointmentBlock,
  buildEventBlock,
  buildAppointmentListBlocks,
  buildEventListBlocks,
};
