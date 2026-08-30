const axios = require("../utils/axiosInstance");

// Smart overlap check (day intersection + hour intersection, checked separately)
const checkSmartOverlap = (newStart, newEnd, existStart, existEnd) => {
  const dNewStart = new Date(newStart);
  const dNewEnd = new Date(newEnd);
  const dExistStart = new Date(existStart);
  const dExistEnd = new Date(existEnd);

  // 1. Day intersection
  const newStartDate = new Date(dNewStart).setHours(0, 0, 0, 0);
  const newEndDate = new Date(dNewEnd).setHours(23, 59, 59, 999);
  const existStartDate = new Date(dExistStart).setHours(0, 0, 0, 0);
  const existEndDate = new Date(dExistEnd).setHours(23, 59, 59, 999);
  if (!(newStartDate <= existEndDate && newEndDate >= existStartDate)) return false;

  // 2. Hour intersection (minutes since start of day)
  const getMinutes = (d) => d.getHours() * 60 + d.getMinutes();
  const newStartMins = getMinutes(dNewStart);
  const newEndMins = getMinutes(dNewEnd);
  const existStartMins = getMinutes(dExistStart);
  const existEndMins = getMinutes(dExistEnd);
  return newStartMins < existEndMins && newEndMins > existStartMins;
};

// Receives platform user IDs (externalIds) + a time range and checks
// appointments and events for conflicts.
async function checkScheduleConflict(
  interaction,
  externalIds,
  startTime,
  endTime,
  excludeAppointmentId = null,
  excludeEventId = null
) {
  if (!externalIds || externalIds.length === 0) return null;
  try {
    // 1. Fetch employees to map platform IDs → database IDs
    const employeesResponse = await axios.get(`${process.env.API_URL}/employees`);
    const employees = employeesResponse.data;
    const targetEmployees = employees.filter((emp) => externalIds.includes(emp.externalId));
    const targetEmployeeIds = targetEmployees.map((emp) => emp.id);

    // Display names as stored in event descriptions
    const targetNames = [];
    for (const extId of externalIds) {
      try {
        const member = await interaction.guild.members.fetch(extId);
        targetNames.push({ name: `@${member.displayName}`, id: extId });
      } catch (err) {
        try {
          const user = await interaction.client.users.fetch(extId);
          targetNames.push({ name: `@${user.displayName || user.username}`, id: extId });
        } catch (e) {}
      }
    }

    // 2. Appointment conflicts
    const appointmentsResponse = await axios.get(`${process.env.API_URL}/calendar/appointments`);
    const overlappingAppointment = appointmentsResponse.data.find((a) => {
      if (excludeAppointmentId && a.id === excludeAppointmentId) return false;
      if (!targetEmployeeIds.includes(a.assigneeId)) return false;
      return checkSmartOverlap(startTime, endTime, a.startTime, a.endTime);
    });
    if (overlappingAppointment) {
      const conflictedUser = targetEmployees.find(
        (e) => e.id === overlappingAppointment.assigneeId
      )?.externalId;
      return {
        type: "Appointment 📆",
        title: overlappingAppointment.title || overlappingAppointment.subject || "Appointment",
        time: `<t:${Math.floor(new Date(overlappingAppointment.startTime).getTime() / 1000)}:f>`,
        conflictedUser: conflictedUser ? `<@${conflictedUser}>` : "Staff member",
      };
    }

    // 3. Event conflicts
    const eventsResponse = await axios.get(`${process.env.API_URL}/calendar/events`);
    const overlappingEvent = eventsResponse.data.find((e) => {
      if (excludeEventId && e.id === excludeEventId) return false;
      const involvesTarget = targetNames.some(
        (t) => e.description && e.description.includes(t.name)
      );
      if (!involvesTarget) return false;
      return checkSmartOverlap(startTime, endTime, e.startDate, e.endDate);
    });
    if (overlappingEvent) {
      const conflictedObj = targetNames.find((t) => overlappingEvent.description.includes(t.name));
      return {
        type: "Event 📅",
        title: overlappingEvent.title,
        time: `<t:${Math.floor(new Date(overlappingEvent.startDate).getTime() / 1000)}:f>`,
        conflictedUser: conflictedObj ? `<@${conflictedObj.id}>` : "Someone",
      };
    }

    return null; // no conflict
  } catch (error) {
    console.error("Error checking conflict:", error);
    return null;
  }
}

module.exports = { checkScheduleConflict };
