const prisma = require("../../prisma");
const {
  addEventToGoogle,
  deleteEventFromGoogle,
  deleteGoogleEventsByIds,
  syncEmailsToGoogle,
} = require("../../utils/googleCalendar");
const {
  syncClassToAccountingSheet,
  syncEventToAccountingSheet,
  removeRecordFromAccountingSheet,
  backfillAccountingSheet,
} = require("../../utils/accountingSheets");
const crypto = require("crypto");

// اسم بديل للحصة لو الـ subject مكتبش — بيدي معلومة مفيدة بدل رقم
function classLabel(cls) {
  if (cls.subject) return cls.subject;
  const teacher = cls.teacher?.name || "TBA";
  const d = new Date(cls.startTime);
  const date = `${d.getDate()}/${d.getMonth() + 1}`;
  return `${teacher} Class - ${date}`;
}

// ========================== Events Services ==========================

async function createEvent(data, options = {}) {
  const { assigneeIds = [], ...eventData } = data;
  const newEvent = await prisma.schoolEvent.create({
    data: {
      ...eventData,
      ...(assigneeIds.length ? { assignees: { connect: assigneeIds.map((id) => ({ id })) } } : {}),
    },
    include: { createdBy: true, assignees: true },
  });

  const validEmails =
    newEvent.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) ||
    [];
  const assigneeNames = newEvent.assignees?.map((emp) => emp.name).join(", ");
  const eventTitle = assigneeNames ? `${assigneeNames} - ${newEvent.title}` : newEvent.title;

  const googleEventId = await addEventToGoogle({
    title: eventTitle,
    description: newEvent.description,
    startDate: newEvent.startDate,
    endDate: newEvent.endDate,
    isAllDay: newEvent.isAllDay,
    targetEmails: validEmails,
  });

  if (!googleEventId?.id) {
    await prisma.schoolEvent.delete({ where: { id: newEvent.id } });
    throw new Error("Failed to connect to Google Calendar.");
  }
  // 💾 تخزين معرفات جوجل للمسح الدقيق لاحقًا
  const withIds = await prisma.schoolEvent.update({
    where: { id: newEvent.id },
    data: { googleEventIds: googleEventId.inserted },
    include: { createdBy: true, assignees: true },
  });
  Object.assign(newEvent, withIds);
  if (!options.skipSheet) {
    syncEventToAccountingSheet(newEvent).catch((err) =>
      console.error("Accounting Sheet Error:", err)
    );
  }
  return newEvent;
}

async function createEventsBulk(data) {
  const { events = [] } = data;
  if (!events.length) throw new Error("No events provided.");
  const groupId = data.groupId || crypto.randomUUID();
  const created = [];
  for (const item of events) {
    created.push(await createEvent({ ...item, groupId }, { skipSheet: true }));
  }
  // 📊 مزامنة واحدة مجمعة بدل 26 مزامنة متوازية (عشان rate limit بتاع جوجل)
  backfillAccountingSheet([], created).catch((err) =>
    console.error("Accounting Sheet Bulk Error:", err)
  );
  return { groupId, created };
}

// 🕐 بيفك "10am" / "10:30 pm" / "14:00" لساعات ودقايق
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

// 📅 بيبني Date جديد: نفس يوم الفعالية (بتوقيت قطر) + الوقت الجديد
function buildQatarDateTime(baseDate, timeParts) {
  const p = new Date(baseDate).toLocaleDateString("en-GB", { timeZone: "Asia/Qatar" }).split("/"); // ["dd","mm","yyyy"]
  const hh = String(timeParts.h).padStart(2, "0");
  const mm = String(timeParts.m).padStart(2, "0");
  return new Date(`${p[2]}-${p[1]}-${p[0]}T${hh}:${mm}:00+03:00`);
}

// 🌟 تحديث التعديل ليدعم تواريخ محددة
async function updateEvent(id, data, scope = "single") {
  const targetEvent = await prisma.schoolEvent.findUnique({
    where: { id },
    include: { assignees: true },
  });
  if (!targetEvent) throw new Error("Event not found");

  let eventsToUpdate = [];
  if (scope === "series" && targetEvent.groupId) {
    eventsToUpdate = await prisma.schoolEvent.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
  } else if (scope === "single" || !scope) {
    eventsToUpdate = [targetEvent];
  } else {
    // scope = تواريخ محددة زي "10/7/2026,11/7/2026"
    if (!targetEvent.groupId) {
      throw new Error(
        "This event is not a day-series. Day-level operations only work on events created with the 'dates' option."
      );
    }
    const targetDates = scope.split(",");
    const allSeries = await prisma.schoolEvent.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
    eventsToUpdate = allSeries.filter((e) => {
      // مقارنة بتوقيت قطر مش توقيت السيرفر
      const parts = new Date(e.startDate)
        .toLocaleDateString("en-GB", { timeZone: "Asia/Qatar" })
        .split("/");
      const edStr = `${Number(parts[0])}/${Number(parts[1])}/${Number(parts[2])}`;
      return targetDates.includes(edStr);
    });
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

    if (ev.googleEventIds) {
      await deleteGoogleEventsByIds(ev.googleEventIds);
    } else {
      // فعاليات قديمة من غير معرفات مخزنة — الطريقة القديمة كخطة بديلة
      try {
        await deleteEventFromGoogle({
          title: oldEventTitle,
          startDate: ev.startDate,
          targetEmails: oldEmails,
        });
      } catch (err) {}
    }

    let dayData = { ...baseData };
    // startTime/endTime مش حقول في الموديل — بنحولهم لـ startDate/endDate وبنشيلهم
    delete dayData.startTime;
    delete dayData.endTime;

    if (baseData.startTime) {
      const t = parseTimeParts(baseData.startTime);
      if (!t)
        throw new Error(
          `Invalid start time format: "${baseData.startTime}". Use e.g. "10am" or "14:30".`
        );
      dayData.startDate = buildQatarDateTime(ev.startDate, t);
      dayData.isAllDay = false;
    }
    if (baseData.endTime) {
      const t = parseTimeParts(baseData.endTime);
      if (!t)
        throw new Error(
          `Invalid end time format: "${baseData.endTime}". Use e.g. "11am" or "15:30".`
        );
      dayData.endDate = buildQatarDateTime(ev.endDate, t);
    }
    if (dayData.startDate && dayData.endDate && dayData.endDate <= dayData.startDate) {
      throw new Error("End time must be after start time.");
    }

    const updated = await prisma.schoolEvent.update({
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
      });
      if (reAdded?.id) {
        await prisma.schoolEvent.update({
          where: { id: updated.id },
          data: { googleEventIds: reAdded.inserted },
        });
      }
    } catch (err) {}

    syncEventToAccountingSheet(updated).catch((err) => console.error("Sheet Error:", err));
    updatedEvents.push(updated);
  }
  return { events: updatedEvents, count: updatedEvents.length };
}

// 🌟 تحديث الحذف ليدعم تواريخ محددة
async function deleteEvent(id, scope = "single") {
  const targetEvent = await prisma.schoolEvent.findUnique({
    where: { id },
    include: { assignees: true },
  });
  if (!targetEvent) throw new Error("Event not found");

  let eventsToDelete = [];
  if (scope === "series" && targetEvent.groupId) {
    eventsToDelete = await prisma.schoolEvent.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
  } else if (scope === "single" || !scope) {
    eventsToDelete = [targetEvent];
  } else {
    // scope = تواريخ محددة زي "10/7/2026,11/7/2026"
    if (!targetEvent.groupId) {
      throw new Error(
        "This event is not a day-series. Day-level operations only work on events created with the 'dates' option."
      );
    }
    const targetDates = scope.split(",");
    const allSeries = await prisma.schoolEvent.findMany({
      where: { groupId: targetEvent.groupId },
      include: { assignees: true },
    });
    eventsToDelete = allSeries.filter((e) => {
      // مقارنة بتوقيت قطر مش توقيت السيرفر
      const parts = new Date(e.startDate)
        .toLocaleDateString("en-GB", { timeZone: "Asia/Qatar" })
        .split("/");
      const edStr = `${Number(parts[0])}/${Number(parts[1])}/${Number(parts[2])}`;
      return targetDates.includes(edStr);
    });
    if (eventsToDelete.length === 0) {
      throw new Error("None of the specified dates were found in this event series.");
    }
  }

  for (const ev of eventsToDelete) {
    const emails =
      ev.assignees?.map((emp) => emp.email).filter((email) => email && email.includes("@")) || [];
    const assigneeNames = ev.assignees?.map((emp) => emp.name).join(", ");
    const eventTitle = assigneeNames ? `${assigneeNames} - ${ev.title}` : ev.title;

    if (ev.googleEventIds) {
      await deleteGoogleEventsByIds(ev.googleEventIds);
    } else {
      // فعاليات قديمة من غير معرفات مخزنة — الطريقة القديمة كخطة بديلة
      try {
        await deleteEventFromGoogle({
          title: eventTitle,
          startDate: ev.startDate,
          targetEmails: emails,
        });
      } catch (err) {}
    }

    await prisma.schoolEvent.delete({ where: { id: ev.id } });
    removeRecordFromAccountingSheet(ev.id).catch((err) => console.error("Sheet Error:", err));
  }
  return { events: eventsToDelete, count: eventsToDelete.length };
}

async function getEvents() {
  return prisma.schoolEvent.findMany({
    orderBy: { startDate: "asc" },
    include: { createdBy: true, assignees: true },
  });
}

// ========================== Classes Services ==========================
async function createClass(data) {
  // اليوم بيتحسب من التاريخ لو المستخدم مكتبوش
  if (!data.day && data.startTime) {
    data.day = new Date(data.startTime).toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Asia/Qatar",
    });
  }

  const newClass = await prisma.schoolClass.create({
    data,
    include: { teacher: true, createdBy: true },
  });

  const label = classLabel(newClass);
  const validEmails =
    newClass.teacher?.email && newClass.teacher.email.includes("@") ? [newClass.teacher.email] : [];

  const googleEventId = await addEventToGoogle({
    title: `${newClass.teacher?.name || "TBA"} - 📘 Class: ${label}`,
    description: `👨‍🏫 Teacher: ${newClass.teacher?.name || "TBA"}\n🏫 Room: ${newClass.room || "TBA"}\n📅 Day: ${newClass.day || "-"}`,
    startDate: newClass.startTime,
    endDate: newClass.endTime,
    isAllDay: newClass.isAllDay, // حصة بلا وقت بتبقى حدث طوال اليوم
    targetEmails: validEmails,
  });

  if (!googleEventId) {
    await prisma.schoolClass.delete({ where: { id: newClass.id } });
    throw new Error("Failed to connect to Google Calendar.");
  }

  syncClassToAccountingSheet(newClass).catch((err) =>
    console.error("[Accounting] Class sync failed:", err.message)
  );
  return newClass;
}
async function updateClass(id, data) {
  const oldClass = await prisma.schoolClass.findUnique({
    where: { id },
    include: { teacher: true },
  });

  if (oldClass) {
    const oldEmails = oldClass.teacher?.email ? [oldClass.teacher.email] : [];
    await deleteEventFromGoogle({
      title: `${oldClass.teacher?.name || "TBA"} - 📘 Class: ${classLabel(oldClass)}`,
      startDate: oldClass.startTime,
      targetEmails: oldEmails,
    });
  }

  // لو التاريخ اتغير من غير ما اليوم يتحدد، نحسبه من الجديد
  if (data.startTime && !data.day) {
    data.day = new Date(data.startTime).toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Asia/Qatar",
    });
  }

  const updatedClass = await prisma.schoolClass.update({
    where: { id },
    data,
    include: { teacher: true, createdBy: true },
  });

  const label = classLabel(updatedClass);
  const validEmails =
    updatedClass.teacher?.email && updatedClass.teacher.email.includes("@")
      ? [updatedClass.teacher.email]
      : [];

  try {
    await addEventToGoogle({
      title: `${updatedClass.teacher?.name || "TBA"} - 📘 Class: ${label}`,
      description: `👨‍🏫 Teacher: ${updatedClass.teacher?.name || "TBA"}\n🏫 Room: ${updatedClass.room || "TBA"}\n📅 Day: ${updatedClass.day || "-"}`,
      startDate: updatedClass.startTime,
      endDate: updatedClass.endTime,
      isAllDay: updatedClass.isAllDay,
      targetEmails: validEmails,
    });
  } catch (err) {}

  syncClassToAccountingSheet(updatedClass).catch((err) =>
    console.error("[Accounting] Class sync failed:", err.message)
  );
  return updatedClass;
}

async function deleteClass(id) {
  const classRecord = await prisma.schoolClass.findUnique({
    where: { id },
    include: { teacher: true },
  });
  if (!classRecord) throw new Error("Class not found");
  try {
    const emails = classRecord.teacher?.email ? [classRecord.teacher.email] : [];
    await deleteEventFromGoogle({
      title: `${classRecord.teacher?.name || "TBA"} - 📘 Class: ${classLabel(classRecord)}`,
      startDate: classRecord.startTime,
      targetEmails: emails,
    });
  } catch (err) {}
  await prisma.schoolClass.delete({ where: { id } });
  removeRecordFromAccountingSheet(id).catch((err) => console.error("Sheet Error:", err));
  return classRecord;
}

async function getClasses() {
  return prisma.schoolClass.findMany({ include: { teacher: true } });
}

// ========================== Bulk & Backfill ==========================

async function createClassesBulk(data) {
  const { classes = [] } = data;
  if (!classes.length) throw new Error("No classes provided.");
  const groupId = data.groupId || crypto.randomUUID();
  const created = [];
  const failed = [];
  for (const item of classes) {
    try {
      const c = await createClass({ ...item, groupId });
      created.push(c);
    } catch (err) {
      failed.push({ startTime: item.startTime, error: err.message });
    }
  }
  return { groupId, created, failed };
}

async function backfillAccounting() {
  const classes = await prisma.schoolClass.findMany({ include: { teacher: true } });
  const events = await prisma.schoolEvent.findMany({ include: { assignees: true } });
  const rowsAdded = await backfillAccountingSheet(classes, events);
  return { classes: classes.length, events: events.length, rowsAdded };
}

async function syncCalendarAccess() {
  const employees = await prisma.employee.findMany();
  const emails = employees.map((emp) => emp.email).filter((email) => email && email.includes("@"));
  if (emails.length === 0) return 0;
  return await syncEmailsToGoogle(emails);
}

module.exports = {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
  createEventsBulk,
  createClass,
  getClasses,
  deleteClass,
  updateClass,
  syncCalendarAccess,
  createClassesBulk,
  backfillAccounting,
};
