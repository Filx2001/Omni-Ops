const prisma = require("../../prisma");
const crypto = require("crypto");
const {
  addEventToGoogle,
  deleteEventFromGoogle,
  deleteGoogleEventsByIds,
  syncEmailsToGoogle,
} = require("../../integrations/googleCalendar");
const {
  syncAppointmentToScheduleSheet,
  syncEventToScheduleSheet,
  removeRecordFromScheduleSheet,
  backfillScheduleSheet,
} = require("../../integrations/scheduleSheets");
const { zonedDate, dateStrInTz, weekdayInTz } = require("../../utils/timezone");

// Fallback label when an appointment has no title
function appointmentLabel(appt) {
  if (appt.title) return appt.title;
  const assignee = appt.assignee?.name || "TBA";
  const d = new Date(appt.startTime);
  return `${assignee} Appointment - ${d.getDate()}/${d.getMonth() + 1}`;
}

// "10am" / "10:30 pm" / "14:00" → { h, m }
function parseTimeParts(t) {
  const s = String(t).trim().toLowerCase();
  const isPM = s.includes("pm");
  const isAM = s.includes("am");
  let [h, m] = s.replace(/[^\d:]/g, "").split(":");
  h = parseInt(h || 0, 10);
  m = parseInt(m || 0, 10);
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  if (isNaN(h) || h > 23 || isNaN(m) || m > 59) return null;
  return { h, m };
}

// Same day as baseDate (in the workspace timezone) + a new wall-clock time
function buildZonedDateTime(baseDate, timeParts, timeZone) {
  const dateStr = dateStrInTz(new Date(baseDate), timeZone);
  return zonedDate(dateStr, timeParts.h, timeParts.m, timeZone);
}

// "d/m/yyyy" key of an instant in the workspace timezone (for scope=date matching)
function dayKey(date, timeZone) {
  const [y, m, d] = dateStrInTz(new Date(date), timeZone).split("-").map(Number);
  return `${d}/${m}/${y}`;
}

// ══════════════════════════ EVENTS ══════════════════════════

async function createEvent(workspace, data, options = {}) {
  const { assigneeIds = [], ...eventData } = data;
  const newEvent = await prisma.event.create({
    data: {
      ...eventData,
      workspaceId: workspace.id,
      ...(assigneeIds.length ? { assignees: { connect: assigneeIds.map((id) => ({ id })) } } : {}),
    },
    include: { createdBy: true, assignees: true },
  });

  const validEmails =
    newEvent.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) ||
    [];
  const assigneeNames = newEvent.assignees?.map((emp) => emp.name).join(", ");
  const eventTitle = assigneeNames ? `${assigneeNames} - ${newEvent.title}` : newEvent.title;

  try {
    const googleEventId = await addEventToGoogle({
      title: eventTitle,
      description: newEvent.description,
      startDate: newEvent.startDate,
      endDate: newEvent.endDate,
      isAllDay: newEvent.isAllDay,
      targetEmails: validEmails,
      workspaceId: workspace.id,
    });
    if (googleEventId?.id) {
      const withIds = await prisma.event.update({
        where: { id: newEvent.id },
        data: { externalCalendarIds: googleEventId.inserted },
        include: { createdBy: true, assignees: true },
      });
      Object.assign(newEvent, withIds);
    }
  } catch (err) {
    console.error("[Google] Event sync failed:", err.message);
  }

  if (!options.skipSheet) {
    syncEventToScheduleSheet(newEvent).catch((err) => console.error("Schedule Sheet Error:", err));
  }
  return newEvent;
}

async function createEventsBulk(workspace, data) {
  const { events = [] } = data;
  if (!events.length) throw new Error("No events provided.");
  const groupId = data.groupId || crypto.randomUUID();
  const created = [];
  for (const item of events) {
    created.push(await createEvent(workspace, { ...item, groupId }, { skipSheet: true }));
  }
  // One batched sheet sync instead of N parallel ones (Google rate limits)
  backfillScheduleSheet([], created).catch((err) =>
    console.error("Schedule Sheet Bulk Error:", err)
  );
  return { groupId, created };
}

async function updateEvent(workspace, id, data, scope = "single") {
  const tz = workspace.timezone || "UTC";
  const targetEvent = await prisma.event.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignees: true },
  });
  if (!targetEvent) throw new Error("Event not found");

  let eventsToUpdate = [];
  if (scope === "series" && targetEvent.groupId) {
    eventsToUpdate = await prisma.event.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
  } else if (scope === "single" || !scope) {
    eventsToUpdate = [targetEvent];
  } else {
    // scope = explicit dates like "10/7/2026,11/7/2026"
    if (!targetEvent.groupId) {
      throw new Error(
        "This event is not a day-series. Day-level operations only work on events created with the 'dates' option."
      );
    }
    const targetDates = scope.split(",");
    const allSeries = await prisma.event.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
    eventsToUpdate = allSeries.filter((e) => targetDates.includes(dayKey(e.startDate, tz)));
    if (eventsToUpdate.length === 0) {
      throw new Error("None of the specified dates were found in this event series.");
    }
  }

  const updatedEvents = [];
  const { assigneeIds, ...baseData } = data;

  for (const ev of eventsToUpdate) {
    const oldEmails =
      ev.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) || [];
    const oldAssigneeNames = ev.assignees?.map((emp) => emp.name).join(", ");
    const oldEventTitle = oldAssigneeNames ? `${oldAssigneeNames} - ${ev.title}` : ev.title;

    if (ev.externalCalendarIds) {
      await deleteGoogleEventsByIds(ev.externalCalendarIds, workspace.id).catch(() => {});
    } else {
      try {
        await deleteEventFromGoogle({
          title: oldEventTitle,
          startDate: ev.startDate,
          targetEmails: oldEmails,
          workspaceId: workspace.id,
        });
      } catch (err) {}
    }

    let dayData = { ...baseData };
    // startTime/endTime are not model fields — convert to startDate/endDate, then drop them
    delete dayData.startTime;
    delete dayData.endTime;
    if (baseData.startTime) {
      const t = parseTimeParts(baseData.startTime);
      if (!t)
        throw new Error(
          `Invalid start time format: "${baseData.startTime}". Use e.g. "10am" or "14:30".`
        );
      dayData.startDate = buildZonedDateTime(ev.startDate, t, tz);
      dayData.isAllDay = false;
    }
    if (baseData.endTime) {
      const t = parseTimeParts(baseData.endTime);
      if (!t)
        throw new Error(
          `Invalid end time format: "${baseData.endTime}". Use e.g. "11am" or "15:30".`
        );
      dayData.endDate = buildZonedDateTime(ev.endDate, t, tz);
    }
    if (dayData.startDate && dayData.endDate && dayData.endDate <= dayData.startDate) {
      throw new Error("End time must be after start time.");
    }

    const updated = await prisma.event.update({
      where: { id: ev.id },
      data: {
        ...dayData,
        ...(assigneeIds ? { assignees: { set: assigneeIds.map((aid) => ({ id: aid })) } } : {}),
      },
      include: { assignees: true, createdBy: true },
    });

    const newEmails =
      updated.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) ||
      [];
    const newAssigneeNames = updated.assignees?.map((emp) => emp.name).join(", ");
    const newEventTitle = newAssigneeNames
      ? `${newAssigneeNames} - ${updated.title}`
      : updated.title;

    try {
      const reAdded = await addEventToGoogle({
        title: newEventTitle,
        description: updated.description,
        startDate: updated.startDate,
        endDate: updated.endDate,
        isAllDay: updated.isAllDay,
        targetEmails: newEmails,
        workspaceId: workspace.id,
      });
      if (reAdded?.id) {
        await prisma.event.update({
          where: { id: updated.id },
          data: { externalCalendarIds: reAdded.inserted },
        });
      }
    } catch (err) {}

    syncEventToScheduleSheet(updated).catch((err) => console.error("Sheet Error:", err));
    updatedEvents.push(updated);
  }
  return { events: updatedEvents, count: updatedEvents.length };
}

async function deleteEvent(workspace, id, scope = "single") {
  const tz = workspace.timezone || "UTC";
  const targetEvent = await prisma.event.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignees: true },
  });
  if (!targetEvent) throw new Error("Event not found");

  let eventsToDelete = [];
  if (scope === "series" && targetEvent.groupId) {
    eventsToDelete = await prisma.event.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
  } else if (scope === "single" || !scope) {
    eventsToDelete = [targetEvent];
  } else {
    if (!targetEvent.groupId) {
      throw new Error(
        "This event is not a day-series. Day-level operations only work on events created with the 'dates' option."
      );
    }
    const targetDates = scope.split(",");
    const allSeries = await prisma.event.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
    eventsToDelete = allSeries.filter((e) => targetDates.includes(dayKey(e.startDate, tz)));
    if (eventsToDelete.length === 0) {
      throw new Error("None of the specified dates were found in this event series.");
    }
  }

  for (const ev of eventsToDelete) {
    const emails =
      ev.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) || [];
    const assigneeNames = ev.assignees?.map((emp) => emp.name).join(", ");
    const eventTitle = assigneeNames ? `${assigneeNames} - ${ev.title}` : ev.title;

    if (ev.externalCalendarIds) {
      await deleteGoogleEventsByIds(ev.externalCalendarIds, workspace.id).catch(() => {});
    } else {
      try {
        await deleteEventFromGoogle({
          title: eventTitle,
          startDate: ev.startDate,
          targetEmails: emails,
          workspaceId: workspace.id,
        });
      } catch (err) {}
    }

    await prisma.event.delete({ where: { id: ev.id } });
    removeRecordFromScheduleSheet(ev.id).catch((err) => console.error("Sheet Error:", err));
  }
  return { events: eventsToDelete, count: eventsToDelete.length };
}

async function getEvents(workspace) {
  return prisma.event.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { startDate: "asc" },
    include: { createdBy: true, assignees: true },
  });
}

// ══════════════════════════ APPOINTMENTS ══════════════════════════

async function createAppointment(workspace, data) {
  // Derive the weekday from the date when the caller didn't provide one
  if (!data.day && data.startTime) {
    data.day = weekdayInTz(new Date(data.startTime), workspace.timezone || "UTC");
  }
  const newAppointment = await prisma.appointment.create({
    data: { ...data, workspaceId: workspace.id },
    include: { assignee: true, createdBy: true },
  });

  const label = appointmentLabel(newAppointment);
  const validEmails =
    newAppointment.assignee?.email && newAppointment.assignee.email.includes("@")
      ? [newAppointment.assignee.email]
      : [];
  try {
    await addEventToGoogle({
      title: `${newAppointment.assignee?.name || "TBA"} - 📅 Appointment: ${label}`,
      description: `👤 Assignee: ${newAppointment.assignee?.name || "TBA"}\n📍 Location: ${newAppointment.location || "TBA"}\n📅 Day: ${newAppointment.day || "-"}`,
      startDate: newAppointment.startTime,
      endDate: newAppointment.endTime,
      isAllDay: newAppointment.isAllDay,
      targetEmails: validEmails,
      workspaceId: workspace.id,
    });
  } catch (err) {
    console.error("[Google] Appointment sync failed:", err.message);
  }

  syncAppointmentToScheduleSheet(newAppointment).catch((err) =>
    console.error("[Schedule] Appointment sync failed:", err.message)
  );
  return newAppointment;
}

async function updateAppointment(workspace, id, data) {
  const oldAppointment = await prisma.appointment.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignee: true },
  });
  if (oldAppointment) {
    const oldEmails = oldAppointment.assignee?.email ? [oldAppointment.assignee.email] : [];
    try {
      await deleteEventFromGoogle({
        title: `${oldAppointment.assignee?.name || "TBA"} - 📅 Appointment: ${appointmentLabel(oldAppointment)}`,
        startDate: oldAppointment.startTime,
        targetEmails: oldEmails,
        workspaceId: workspace.id,
      });
    } catch (err) {}
  }

  if (data.startTime && !data.day) {
    data.day = weekdayInTz(new Date(data.startTime), workspace.timezone || "UTC");
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data,
    include: { assignee: true, createdBy: true },
  });

  const label = appointmentLabel(updated);
  const validEmails =
    updated.assignee?.email && updated.assignee.email.includes("@") ? [updated.assignee.email] : [];
  try {
    await addEventToGoogle({
      title: `${updated.assignee?.name || "TBA"} - 📅 Appointment: ${label}`,
      description: `👤 Assignee: ${updated.assignee?.name || "TBA"}\n📍 Location: ${updated.location || "TBA"}\n📅 Day: ${updated.day || "-"}`,
      startDate: updated.startTime,
      endDate: updated.endTime,
      isAllDay: updated.isAllDay,
      targetEmails: validEmails,
      workspaceId: workspace.id,
    });
  } catch (err) {}

  syncAppointmentToScheduleSheet(updated).catch((err) =>
    console.error("[Schedule] Appointment sync failed:", err.message)
  );
  return updated;
}

async function deleteAppointment(workspace, id) {
  const record = await prisma.appointment.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { assignee: true },
  });
  if (!record) throw new Error("Appointment not found");

  try {
    const emails = record.assignee?.email ? [record.assignee.email] : [];
    await deleteEventFromGoogle({
      title: `${record.assignee?.name || "TBA"} - 📅 Appointment: ${appointmentLabel(record)}`,
      startDate: record.startTime,
      targetEmails: emails,
      workspaceId: workspace.id,
    });
  } catch (err) {}

  await prisma.appointment.delete({ where: { id } });
  removeRecordFromScheduleSheet(id).catch((err) => console.error("Sheet Error:", err));
  return record;
}

async function getAppointments(workspace) {
  return prisma.appointment.findMany({
    where: { workspaceId: workspace.id },
    include: { assignee: true },
  });
}

// ══════════════════════════ BULK & BACKFILL ══════════════════════════

async function createAppointmentsBulk(workspace, data) {
  const { appointments = [] } = data;
  if (!appointments.length) throw new Error("No appointments provided.");
  const groupId = data.groupId || crypto.randomUUID();
  const created = [];
  const failed = [];
  for (const item of appointments) {
    try {
      created.push(await createAppointment(workspace, { ...item, groupId }));
    } catch (err) {
      failed.push({ startTime: item.startTime, error: err.message });
    }
  }
  return { groupId, created, failed };
}

async function backfillAccounting(workspace) {
  const appointments = await prisma.appointment.findMany({
    where: { workspaceId: workspace.id },
    include: { assignee: true },
  });
  const events = await prisma.event.findMany({
    where: { workspaceId: workspace.id },
    include: { assignees: true },
  });
  const rowsAdded = await backfillScheduleSheet(appointments, events);
  return { appointments: appointments.length, events: events.length, rowsAdded };
}

async function syncCalendarAccess(workspace) {
  const employees = await prisma.employee.findMany({ where: { workspaceId: workspace.id } });
  const emails = employees.map((emp) => emp.email).filter((email) => email && email.includes("@"));
  if (emails.length === 0) return 0;
  return await syncEmailsToGoogle(emails, workspace.id);
}

module.exports = {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
  createEventsBulk,
  createAppointment,
  getAppointments,
  deleteAppointment,
  updateAppointment,
  syncCalendarAccess,
  createAppointmentsBulk,
  backfillAccounting,
};
