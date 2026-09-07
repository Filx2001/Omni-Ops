/**
 * Typeahead handlers for appointment and event selects.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { appointmentLabel } = require("../utils/calendarUtils");

/** Feeds appointment_select elements. */
async function handleAppointmentOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();

  try {
    const response = await runWithTenant(workspaceId, () => axios.get(`/calendar/appointments`));
    const appointments = response.data || [];

    const groupCounts = {};
    for (const a of appointments) {
      if (a.groupId) groupCounts[a.groupId] = (groupCounts[a.groupId] || 0) + 1;
    }

    const filtered = appointments
      .filter((a) => appointmentLabel(a).toLowerCase().includes(search))
      .slice(0, 25);

    await ack({
      options: filtered.map((a) => {
        const dateStr = new Date(a.startTime).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
        });
        const seriesTag = a.groupId ? ` 🔁${groupCounts[a.groupId]}` : "";
        return {
          text: {
            type: "plain_text",
            text: `${appointmentLabel(a)} ${dateStr}${seriesTag}`.substring(0, 75),
          },
          value: a.id,
        };
      }),
    });
  } catch (error) {
    console.error("Appointment options fetch failed:", error.message);
    await ack({ options: [] });
  }
}

/** Feeds event_select elements. */
async function handleEventOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();

  try {
    const response = await runWithTenant(workspaceId, () => axios.get(`/calendar/events`));
    const events = response.data || [];

    const groupCounts = {};
    for (const e of events) {
      if (e.groupId) groupCounts[e.groupId] = (groupCounts[e.groupId] || 0) + 1;
    }

    const filtered = events.filter((e) => e.title.toLowerCase().includes(search)).slice(0, 25);

    await ack({
      options: filtered.map((e) => {
        const dateStr = new Date(e.startDate).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
        });
        const seriesTag = e.groupId ? ` 🔁${groupCounts[e.groupId]}` : "";
        return {
          text: {
            type: "plain_text",
            text: `${e.title} ${dateStr}${seriesTag}`.substring(0, 75),
          },
          value: e.id,
        };
      }),
    });
  } catch (error) {
    console.error("Event options fetch failed:", error.message);
    await ack({ options: [] });
  }
}

module.exports = { handleAppointmentOptions, handleEventOptions };
