const { Events, ChannelType, EmbedBuilder } = require("discord.js");
const { resolveAiConfig, createAiClient } = require("../utils/aiGateway");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");
const { AssemblyAI } = require("assemblyai");
const { getCachedData, clearCache } = require("../utils/cache");
const {
  notifyScheduleChannel,
  notifyBillingChannel,
  notifyTask,
  notifyAppointment,
  notifyEvent,
} = require("../utils/dmNotifier");
const {
  parseLocalDateTime,
  isValidYear,
  parseSeriesDates,
  resolveTimeZone,
} = require("../utils/dateParser");
const { checkScheduleConflict } = require("../utils/conflictChecker");
const { tools, MUTATING_TOOLS, getZonedDateStr, parseDueDate } = require("../utils/aiTools");
const { getWorkspace } = require("../utils/workspace");
const { runWithTenant } = require("../utils/tenantContext");

const aai = process.env.ASSEMBLYAI_API_KEY
  ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
  : null;

// =================== Confirmation System ===================
const pendingActions = new Map();
const conversationHistory = new Map();
const HISTORY_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, h] of conversationHistory.entries()) {
    if (!h._lastUpdate || now - h._lastUpdate > HISTORY_TIMEOUT_MS) {
      conversationHistory.delete(id);
    }
  }
}, 60_000);

const HISTORY_MAX_TURNS = 10;
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;
const CONFIRM_WORDS = ["confirm", "yes", "y", "ok", "تأكيد", "اكد", "أكد", "تاكيد", "نعم", "اوك"];
const CANCEL_WORDS = ["cancel", "no", "n", "الغاء", "إلغاء", "لا"];

function cleanupExpired() {
  const now = Date.now();
  for (const [key, val] of pendingActions.entries()) {
    if (val.expiresAt < now) pendingActions.delete(key);
  }
}

function describeAction(call, args, dataMaps) {
  switch (call.name) {
    case "createTask": {
      const emp = dataMaps.empById.get(args.employeeId);
      return `➕ **Create New Task**\n📋 Title: ${args.title}\n👤 For: ${emp?.name || "⚠️ Unknown Employee"}\n🔥 Priority: ${args.priority}${args.dueDate ? `\n📅 Due: ${args.dueDate}` : ""}`;
    }
    case "updateTaskStatus": {
      const task = dataMaps.taskById.get(args.taskId);
      return `✏️ **Update Task Status**\n📋 Task: ${task?.title || "⚠️ Not Found"}\n📊 New Status: ${args.status}`;
    }
    case "deleteTask": {
      const task = dataMaps.taskById.get(args.taskId);
      return `🗑️ **Delete Task**\n📋 Task: ${task?.title || "⚠️ Not Found"}`;
    }
    case "addAppointment": {
      const assignee = dataMaps.empById.get(args.assigneeId);
      return `➕ **Schedule New Appointment**\n📘 Title: ${args.title || "Auto-named"}\n👤 Assignee: ${assignee?.name || "⚠️ Unknown"}\n📅 Day: ${args.day || "TBA"}\n⏰ From ${args.startTime} to ${args.endTime}`;
    }
    case "updateAppointment": {
      const appt = dataMaps.apptById.get(args.appointmentId);
      const assignee = args.assigneeId ? dataMaps.empById.get(args.assigneeId) : null;
      const changes = [
        args.title ? `📘 Title → ${args.title}` : null,
        args.day ? `📅 Day → ${args.day}` : null,
        args.startTime ? `⏰ Start → ${args.startTime}` : null,
        args.endTime ? `⏰ End → ${args.endTime}` : null,
        args.location ? `📍 Location → ${args.location}` : null,
        assignee ? `👤 Assignee → ${assignee.name}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `✏️ **Update Appointment**\n📘 Appointment: ${appt?.title || "⚠️ Not Found"}\n${changes || "No fields provided"}`;
    }
    case "deleteAppointment": {
      const appt = dataMaps.apptById.get(args.appointmentId);
      return `🗑️ **Delete Appointment**\n📘 Title: ${appt?.title || "⚠️ Not Found"}`;
    }
    case "createEvent": {
      const n = (args.assigneeIds || []).length;
      return `➕ **Create Event**\n📌 Title: ${args.title}\n🏷️ Type: ${args.type}\n⏰ From ${args.startDate} to ${args.endDate}${n ? `\n👥 Assignees: ${n}` : ""}`;
    }
    case "updateEvent": {
      const ev = dataMaps.eventById.get(args.eventId);
      const changes = [
        args.title ? `📌 Title → ${args.title}` : null,
        args.type ? `🏷️ Type → ${args.type}` : null,
        args.startDate ? `⏰ Start → ${args.startDate}` : null,
        args.endDate ? `⏰ End → ${args.endDate}` : null,
        (args.assigneeIds || []).length
          ? `👥 Assignees → ${(args.assigneeIds || []).length}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `✏️ **Update Event**\n📌 Event: ${ev?.title || "⚠️ Not Found"}\n${changes || "No fields provided"}`;
    }
    case "deleteEvent": {
      const ev = dataMaps.eventById.get(args.eventId);
      return `🗑️ **Delete Event**\n📌 Event: ${ev?.title || "⚠️ Not Found"}`;
    }
    case "updateLeadStatus": {
      const lead = dataMaps.leadById.get(args.leadId);
      return `🚦 **Update Lead Status**\n👤 Lead: ${lead?.name || "⚠️ Not Found"}\n➡️ New Status: ${args.status}`;
    }
    case "createInvoice": {
      const gross = args.amount * (args.quantity || 1);
      const net = gross - ((args.discount || 0) / 100) * gross;
      return `➕ **Create New Invoice**\n👤 Name: ${args.customerName}\n🎯 Service: ${args.category}\n💰 Unit Price: ${args.amount} × ${args.quantity || 1}${args.discount ? `\n🔻 Discount: ${args.discount}%` : ""}\n💵 Net Total: ${net}${args.description ? `\n📄 Description: ${args.description}` : ""}`;
    }
    case "updateInvoiceStatus": {
      const inv = dataMaps.invById?.get(args.invoiceId);
      return `🔄 **Update Invoice Status**\n🧾 Invoice: ${inv?.customerName || args.invoiceId}\n🚦 New Status: ${args.status}`;
    }
    case "createLead":
      return `➕ **Add New Lead**\n📱 Phone: ${args.phone}${args.name ? `\n👤 Name: ${args.name}` : ""}\n🔗 Source: ${args.source || "MANUAL"}`;
    case "assignLead": {
      const lead = dataMaps.leadById.get(args.leadId);
      const emp = dataMaps.empById.get(args.employeeId);
      return `👤 **Assign Lead**\n📇 Lead: ${lead?.name || "⚠️ Not Found"}\n➡️ To: ${emp?.name || "⚠️ Unknown Employee"}`;
    }
    case "addLeadNote": {
      const lead = dataMaps.leadById.get(args.leadId);
      return `📝 **Add Note**\n📇 Lead: ${lead?.name || "⚠️ Not Found"}\n💬 ${args.note}`;
    }
    case "stopCampaign": {
      const c = dataMaps.campaignById?.get(args.campaignId);
      return `⏸️ **Stop Campaign**\n📣 ${c?.name || args.campaignId}\n⚠️ Sending will halt immediately.`;
    }
    default:
      return `⚠️ Operation: ${call.name}`;
  }
}

async function validateActionIds(call, args, dataMaps, message) {
  let parsedDateToCheck = null;
  if (args.dueDate) parsedDateToCheck = parseDueDate(args.dueDate);
  else if (args.startTime) parsedDateToCheck = getZonedDateStr(args.startTime);
  else if (args.startDate) parsedDateToCheck = getZonedDateStr(args.startDate);
  if (parsedDateToCheck && !isValidYear(parsedDateToCheck)) {
    return "Action denied: Cannot schedule or update records in past years.";
  }

  if (args.dates) {
    const ds = parseSeriesDates(args.dates);
    if (!ds) return "Invalid 'dates' format. Use '1-15' or '1,3,7' with optional '/month'.";
    for (const d of ds) {
      const r = parseLocalDateTime(d, "12:00");
      if (!r || !isValidYear(r.date)) return `Action denied: ${d} is in a past month.`;
    }
  }

  const checkAssignees = () => {
    const ids = args.assigneeIds || [];
    const missing = ids.find((id) => !dataMaps.empById.has(id));
    return missing ? `Assignee not found in the system (${missing}).` : true;
  };

  switch (call.name) {
    case "createTask":
      return dataMaps.empById.has(args.employeeId) || "Employee not found in the system.";
    case "updateTaskStatus":
    case "deleteTask":
      return dataMaps.taskById.has(args.taskId) || "Task not found.";
    case "addAppointment": {
      if (!dataMaps.empById.has(args.assigneeId)) return "Assignee not found in the system.";
      const assignee = dataMaps.empById.get(args.assigneeId);
      if (assignee?.externalId && args.startTime && args.endTime) {
        const getLocalDate = (str) => {
          const [d, t] = str.replace("T", " ").split(" ");
          return parseLocalDateTime(d, t)?.date;
        };
        const startTime = getLocalDate(args.startTime);
        const endTime = getLocalDate(args.endTime);
        const conflict = await checkScheduleConflict(
          message,
          [assignee.externalId],
          startTime,
          endTime
        );
        if (conflict) {
          return `Schedule Conflict! This staff member is already busy with a ${conflict.type} (${conflict.title}) at that time.`;
        }
      }
      return true;
    }
    case "updateAppointment": {
      if (!dataMaps.apptById.has(args.appointmentId)) return "Appointment not found.";
      if (args.assigneeId && !dataMaps.empById.has(args.assigneeId))
        return "New assignee not found.";
      const currentAppt = dataMaps.apptById.get(args.appointmentId);
      const assigneeId = args.assigneeId || currentAppt?.assigneeId;
      const assignee = dataMaps.empById.get(assigneeId);
      if (assignee?.externalId && (args.startTime || args.endTime)) {
        const getLocalDate = (str) => {
          const [d, t] = str.replace("T", " ").split(" ");
          return parseLocalDateTime(d, t)?.date;
        };
        const startTime = args.startTime
          ? getLocalDate(args.startTime)
          : new Date(currentAppt.startTime);
        const endTime = args.endTime ? getLocalDate(args.endTime) : new Date(currentAppt.endTime);
        const conflict = await checkScheduleConflict(
          message,
          [assignee.externalId],
          startTime,
          endTime,
          args.appointmentId
        );
        if (conflict) {
          return `Schedule Conflict! This update overlaps with another ${conflict.type} (${conflict.title}).`;
        }
      }
      return true;
    }
    case "createEvent": {
      const assigneeCheck = checkAssignees();
      if (assigneeCheck !== true) return assigneeCheck;
      const ids = args.assigneeIds || [];
      const externalIds = ids.map((id) => dataMaps.empById.get(id)?.externalId).filter(Boolean);
      if (externalIds.length > 0 && args.startDate && args.endDate) {
        const getLocalDate = (str) => {
          const parts = str.replace("T", " ").split(" ");
          const datePart = parts[0];
          const timePart = parts.slice(1).join(" ");
          return parseLocalDateTime(datePart, timePart)?.date;
        };
        const startTime = getLocalDate(args.startDate);
        const endTime = getLocalDate(args.endDate);
        if (startTime && endTime) {
          const conflict = await checkScheduleConflict(message, externalIds, startTime, endTime);
          if (conflict) {
            return `Schedule Conflict! One of the assignees is already busy with a ${conflict.type} (${conflict.title}) at that time.`;
          }
        }
      }
      return true;
    }
    case "updateEvent": {
      if (!dataMaps.eventById.has(args.eventId)) return "Event not found.";
      const assigneeCheck = checkAssignees();
      if (assigneeCheck !== true) return assigneeCheck;
      const currentEvent = dataMaps.eventById.get(args.eventId);
      const getLocalDate = (str) => {
        const parts = str.replace("T", " ").split(" ");
        const datePart = parts[0];
        const timePart = parts.slice(1).join(" ");
        return parseLocalDateTime(datePart, timePart)?.date;
      };
      const startTime = args.startDate
        ? getLocalDate(args.startDate)
        : new Date(currentEvent.startDate);
      const endTime = args.endDate ? getLocalDate(args.endDate) : new Date(currentEvent.endDate);
      let externalIds = [];
      if (args.assigneeIds) {
        externalIds = args.assigneeIds
          .map((id) => dataMaps.empById.get(id)?.externalId)
          .filter(Boolean);
      }
      if (externalIds.length > 0 && startTime && endTime) {
        const conflict = await checkScheduleConflict(
          message,
          externalIds,
          startTime,
          endTime,
          null,
          args.eventId
        );
        if (conflict) {
          return `Schedule Conflict! This update overlaps with another ${conflict.type} (${conflict.title}).`;
        }
      }
      return true;
    }
    case "deleteAppointment":
      return dataMaps.apptById.has(args.appointmentId) || "Appointment not found.";
    case "deleteEvent":
      return dataMaps.eventById.has(args.eventId) || "Event not found.";
    case "updateLeadStatus":
      return dataMaps.leadById.has(args.leadId) || "Lead not found.";
    case "updateInvoiceStatus":
      return dataMaps.invById.has(args.invoiceId) || "Invoice not found.";
    case "assignLead":
      if (!dataMaps.leadById.has(args.leadId)) return "Lead not found.";
      return dataMaps.empById.has(args.employeeId) || "Employee not found in the system.";
    case "addLeadNote":
      return dataMaps.leadById.has(args.leadId) || "Lead not found.";
    case "stopCampaign":
      return dataMaps.campaignById?.has(args.campaignId) || "Campaign not found.";
    default:
      return true;
  }
}

async function safeNotify(label, fn) {
  try {
    await fn();
    console.log(`✅ DM notification sent [${label}].`);
  } catch (err) {
    console.error(`⚠️ DM notify failed [${label}]:`, err?.message || err);
  }
}

async function resolveExternalId(employeeId, relationObj) {
  if (relationObj?.externalId) return relationObj.externalId;
  if (!employeeId) return null;
  try {
    const res = await axios.get(`/employees/${employeeId}`);
    const id = res.data?.externalId || null;
    if (!id) console.warn(`ℹ️ Employee ${employeeId} has no externalId linked — DM skipped.`);
    return id;
  } catch (err) {
    console.error(
      `⚠️ Failed to fetch employee ${employeeId} for DM:`,
      err.response?.data?.error || err.message
    );
    return null;
  }
}

async function resolveExternalIds(employeeIds = [], relationArr = []) {
  const ids = new Set();
  for (const a of relationArr || []) {
    if (a?.externalId) ids.add(a.externalId);
  }
  if (ids.size === 0) {
    for (const empId of employeeIds || []) {
      const did = await resolveExternalId(empId);
      if (did) ids.add(did);
    }
  }
  return [...ids];
}

async function executeAction(call, args, manager, message) {
  const guildId = message.guildId || message.client.guilds.cache.first()?.id;
  const actorExternalId = manager.externalId || message.author?.id;

  switch (call.name) {
    case "createTask": {
      const { employeeId, ...taskArgs } = args;
      const taskRes = await axios.post("/tasks", {
        ...taskArgs,
        assignedToId: employeeId,
        createdById: manager.id,
        dueDate: taskArgs.dueDate ? parseDueDate(taskArgs.dueDate) : undefined,
      });
      clearCache("all_tasks");
      const assignedEmp = await axios.get(`/employees/${employeeId}`).catch(() => null);
      const empExternalId = assignedEmp?.data?.externalId || taskRes.data?.assignedTo?.externalId;
      if (empExternalId) {
        await safeNotify("createTask", () =>
          notifyTask(message.client, empExternalId, "create", taskRes.data, actorExternalId)
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "📋 New Task Assigned",
        `Title: **${taskRes.data.title}**\nAssigned to: ${assignedEmp?.data?.name || "Unknown"}\nPriority: ${args.priority}${taskRes.data.dueDate ? `\nDue: <t:${Math.floor(new Date(taskRes.data.dueDate).getTime() / 1000)}:D>` : ""}`
      );
      return "✅ Task created and assigned successfully.";
    }
    case "updateTaskStatus": {
      const updateRes = await axios.patch(`/tasks/${args.taskId}/status`, { status: args.status });
      clearCache("all_tasks");
      const empExternalId = updateRes.data?.assignedTo?.externalId;
      if (empExternalId) {
        await safeNotify("updateTaskStatus", () =>
          notifyTask(message.client, empExternalId, "update", updateRes.data, actorExternalId)
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "✏️ Task Status Updated",
        `Task: **${updateRes.data.title}**\nNew Status: **${args.status}**`,
        EMBED_COLORS.UPDATE
      );
      return "✅ Task status updated successfully.";
    }
    case "deleteTask": {
      const delTask = await axios.delete(`/tasks/${args.taskId}`);
      clearCache("all_tasks");
      const empExternalId = delTask.data?.assignedTo?.externalId;
      if (empExternalId) {
        await safeNotify("deleteTask", () =>
          notifyTask(message.client, empExternalId, "delete", delTask.data, actorExternalId)
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "🗑️ Task Deleted",
        `Deleted: **${delTask.data.title}**`,
        EMBED_COLORS.DELETE
      );
      return "🗑️ Task deleted successfully.";
    }
    case "addAppointment": {
      const zTime = (str) => {
        const iso = getZonedDateStr(str);
        return iso
          ? new Date(iso).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: resolveTimeZone(),
            })
          : null;
      };
      if (args.dates) {
        const dateStrs = parseSeriesDates(args.dates);
        const st = zTime(args.startTime);
        const et = zTime(args.endTime);
        if (!dateStrs || !st || !et) return "❌ Invalid series dates or times.";
        const items = dateStrs.map((dStr) => {
          const s = parseLocalDateTime(dStr, st).date;
          const e = parseLocalDateTime(dStr, et).date;
          return {
            title: args.title,
            day: s.toLocaleDateString("en-US", { weekday: "long", timeZone: resolveTimeZone() }),
            startTime: s,
            endTime: e,
            assigneeId: args.assigneeId,
            location: args.location || "TBA",
            createdById: manager.id,
          };
        });
        const bulkRes = await axios.post("/calendar/appointments/bulk", { appointments: items });
        clearCache("appointments_list");
        const assigneeExternalId = await resolveExternalId(args.assigneeId);
        if (assigneeExternalId && bulkRes.data.created?.[0]) {
          await safeNotify("addAppointment series", () =>
            notifyAppointment(
              message.client,
              assigneeExternalId,
              "create",
              bulkRes.data.created[0],
              actorExternalId
            )
          );
        }
        await logToScheduleChannel(
          message.client,
          guildId,
          "🔁 Appointment Series Scheduled",
          `Title: **${args.title || "Appointment"}**\nDays: ${bulkRes.data.created?.length || 0}${bulkRes.data.failed?.length ? `\n⏭️ Failed: ${bulkRes.data.failed.length}` : ""}`
        );
        return `✅ Scheduled **${bulkRes.data.created?.length || 0}** appointments (series).${bulkRes.data.failed?.length ? ` ⏭️ ${bulkRes.data.failed.length} day(s) failed.` : ""}`;
      }
      const apptRes = await axios.post("/calendar/appointments", {
        ...args,
        location: args.location || "TBA",
        createdById: manager.id,
        startTime: getZonedDateStr(args.startTime),
        endTime: getZonedDateStr(args.endTime),
      });
      clearCache("appointments_list");
      const assignee = await axios.get(`/employees/${args.assigneeId}`).catch(() => null);
      const assigneeExternalId = assignee?.data?.externalId || apptRes.data?.assignee?.externalId;
      if (assigneeExternalId) {
        await safeNotify("addAppointment", () =>
          notifyAppointment(
            message.client,
            assigneeExternalId,
            "create",
            apptRes.data,
            actorExternalId
          )
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "📅 New Appointment Scheduled",
        `Title: **${apptRes.data.title || "Appointment"}**\nAssignee: ${assignee?.data?.name || "Unknown"}\nDay: ${args.day}\nLocation: ${args.location || "TBA"}`
      );
      return "✅ Appointment scheduled successfully.";
    }
    case "updateAppointment": {
      const updatePayload = {
        ...args,
        startTime: getZonedDateStr(args.startTime),
        endTime: getZonedDateStr(args.endTime),
      };
      delete updatePayload.appointmentId;
      const apptUpdRes = await axios.patch(
        `/calendar/appointments/${args.appointmentId}`,
        updatePayload
      );
      clearCache("appointments_list");
      const assigneeExternalId =
        apptUpdRes.data?.assignee?.externalId ||
        (args.assigneeId ? await resolveExternalId(args.assigneeId) : null);
      if (assigneeExternalId) {
        await safeNotify("updateAppointment", () =>
          notifyAppointment(
            message.client,
            assigneeExternalId,
            "update",
            apptUpdRes.data,
            actorExternalId
          )
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "✏️ Appointment Updated",
        `**${apptUpdRes.data?.title || "Appointment"}** has been updated.`,
        EMBED_COLORS.UPDATE
      );
      return "✅ Appointment updated successfully.";
    }
    case "deleteAppointment": {
      const delAppt = await axios.delete(`/calendar/appointments/${args.appointmentId}`);
      clearCache("appointments_list");
      const assigneeExternalId = delAppt.data?.assignee?.externalId;
      if (assigneeExternalId) {
        await safeNotify("deleteAppointment", () =>
          notifyAppointment(
            message.client,
            assigneeExternalId,
            "delete",
            delAppt.data,
            actorExternalId
          )
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "🗑️ Appointment Deleted",
        `Removed: **${delAppt.data?.title || "An appointment"}** from the schedule.`,
        EMBED_COLORS.DELETE
      );
      return "🗑️ Appointment deleted from the schedule.";
    }
    case "createEvent": {
      const { assigneeIds, dates, ...eventArgs } = args;
      const zTime = (str) => {
        const iso = getZonedDateStr(str);
        return iso
          ? new Date(iso).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: resolveTimeZone(),
            })
          : null;
      };
      if (dates) {
        const dateStrs = parseSeriesDates(dates);
        const st = zTime(args.startDate);
        const et = zTime(args.endDate);
        if (!dateStrs || !st || !et) return "❌ Invalid series dates or times.";
        const items = dateStrs.map((dStr) => ({
          ...eventArgs,
          startDate: parseLocalDateTime(dStr, st).date,
          endDate: parseLocalDateTime(dStr, et).date,
          assigneeIds: assigneeIds || [],
          createdById: manager.id,
        }));
        const bulkRes = await axios.post("/calendar/events/bulk", { events: items });
        clearCache("events_list");
        const externalIds = await resolveExternalIds(
          assigneeIds,
          bulkRes.data.created?.[0]?.assignees
        );
        if (externalIds.length && bulkRes.data.created?.[0]) {
          await safeNotify("createEvent series", () =>
            notifyEvent(
              message.client,
              externalIds,
              "create",
              bulkRes.data.created[0],
              actorExternalId
            )
          );
        }
        await logToScheduleChannel(
          message.client,
          guildId,
          "🔁 Event Series Added",
          `Title: **${args.title}**\nDays: ${bulkRes.data.created?.length || 0}`
        );
        return `✅ Created **${bulkRes.data.created?.length || 0}** event day(s) (series).`;
      }
      const eventRes = await axios.post("/calendar/events", {
        ...eventArgs,
        assigneeIds: assigneeIds || [],
        createdById: manager.id,
        startDate: getZonedDateStr(args.startDate),
        endDate: getZonedDateStr(args.endDate),
      });
      clearCache("events_list");
      const externalIds = await resolveExternalIds(assigneeIds, eventRes.data?.assignees);
      if (externalIds.length) {
        await safeNotify("createEvent", () =>
          notifyEvent(message.client, externalIds, "create", eventRes.data, actorExternalId)
        );
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "📅 New Event Added",
        `Title: **${eventRes.data.title}**\nType: ${args.type}\nStarts: <t:${Math.floor(new Date(eventRes.data.startDate).getTime() / 1000)}:F>`
      );
      return "✅ Event added to calendar successfully.";
    }
    case "updateEvent": {
      const { assigneeIds, eventId, scope, startTime, endTime, ...eventArgs } = args;
      const isSeriesScope = scope && scope !== "single";
      const payload = { ...eventArgs };
      if (isSeriesScope) {
        delete payload.startDate;
        delete payload.endDate;
        if (startTime) payload.startTime = startTime;
        if (endTime) payload.endTime = endTime;
      } else {
        if (args.startDate) payload.startDate = getZonedDateStr(args.startDate);
        if (args.endDate) payload.endDate = getZonedDateStr(args.endDate);
      }
      if (assigneeIds) payload.assigneeIds = assigneeIds;
      const eventUpdRes = await axios.patch(
        `/calendar/events/${eventId}?scope=${encodeURIComponent(scope || "single")}`,
        payload
      );
      clearCache("events_list");
      const affected = eventUpdRes.data?.events || [];
      const notified = new Set();
      for (const ev of affected) {
        for (const a of ev.assignees || []) {
          if (a.externalId && !notified.has(a.externalId)) {
            notified.add(a.externalId);
            await safeNotify("updateEvent", () =>
              notifyEvent(message.client, [a.externalId], "update", ev, actorExternalId)
            );
          }
        }
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "✏️ Event Updated",
        `**${affected[0]?.title || "Event"}** — ${eventUpdRes.data?.count || 1} day(s) updated.`,
        EMBED_COLORS.UPDATE
      );
      return `✅ Event updated — ${eventUpdRes.data?.count || 1} day(s).`;
    }
    case "deleteEvent": {
      const delScope = args.scope || "single";
      const delEvent = await axios.delete(
        `/calendar/events/${args.eventId}?scope=${encodeURIComponent(delScope)}`
      );
      clearCache("events_list");
      const affected = delEvent.data?.events || [];
      const notified = new Set();
      for (const ev of affected) {
        for (const a of ev.assignees || []) {
          if (a.externalId && !notified.has(a.externalId)) {
            notified.add(a.externalId);
            await safeNotify("deleteEvent", () =>
              notifyEvent(message.client, [a.externalId], "delete", ev, actorExternalId)
            );
          }
        }
      }
      await logToScheduleChannel(
        message.client,
        guildId,
        "🗑️ Event Deleted",
        `Removed **${affected[0]?.title || "an event"}** — ${delEvent.data?.count || 1} day(s).`,
        EMBED_COLORS.DELETE
      );
      return `🗑️ Deleted ${delEvent.data?.count || 1} event day(s).`;
    }
    case "updateLeadStatus": {
      await axios.patch(`/crm/leads/${args.leadId}/status`, { status: args.status });
      clearCache("leads_list");
      await logToScheduleChannel(
        message.client,
        guildId,
        "🚦 Lead Status Updated",
        `Status changed to: **${args.status}**`,
        EMBED_COLORS.UPDATE
      );
      return "✅ Lead status updated successfully.";
    }
    case "createInvoice": {
      const invRes = await axios.post("/invoices", {
        customerName: args.customerName,
        category: args.category,
        description: args.description || "",
        amount: args.amount,
        quantity: args.quantity || 1,
        discount: args.discount || 0,
        status: args.status || "PENDING",
        createdById: manager.id,
        issuedByName: message.member?.displayName || message.author.username,
      });
      clearCache("invoices_list");
      await logToBillingChannel(
        message.client,
        guildId,
        "🧾 New Invoice Created",
        `Name: **${args.customerName}**\nService: ${args.category}\nNet Total: **${invRes.data.netAmount}**`
      );
      return `✅ Invoice INV-${invRes.data.invoiceNumber ?? invRes.data.referenceId} created successfully.`;
    }
    case "updateInvoiceStatus": {
      await axios.patch(`/invoices/${args.invoiceId}/status`, { status: args.status });
      clearCache("invoices_list");
      await logToBillingChannel(
        message.client,
        guildId,
        "🔄 Invoice Status Updated",
        `Status changed to: **${args.status}**`,
        EMBED_COLORS.UPDATE
      );
      return "✅ Invoice payment status updated successfully.";
    }
    case "createLead": {
      try {
        const leadRes = await axios.post("/crm/leads", {
          phone: args.phone,
          name: args.name,
          source: args.source || "MANUAL",
          notes: args.notes,
          addedByName: manager.name,
        });
        clearCache("leads_list");
        await logToScheduleChannel(
          message.client,
          guildId,
          "➕ New Lead Added",
          `Name: **${leadRes.data.name}**\nPhone: ${leadRes.data.phone}\nSource: ${args.source || "MANUAL"}`
        );
        return `✅ Lead added: **${leadRes.data.name}** (${leadRes.data.phone})`;
      } catch (err) {
        if (err.response?.status === 409) {
          const existing = err.response.data.lead;
          return `⚠️ This number already exists: **${existing.name}** — status ${existing.status}`;
        }
        if (err.response?.status === 400) return "❌ Invalid phone number.";
        throw err;
      }
    }
    case "assignLead": {
      const res = await axios.patch(`/crm/leads/${args.leadId}/assign`, {
        employeeId: args.employeeId,
      });
      clearCache("leads_list");
      return `✅ **${res.data.name}** assigned to **${res.data.assignedTo?.name || "employee"}**`;
    }
    case "addLeadNote": {
      const res = await axios.patch(`/crm/leads/${args.leadId}/note`, { note: args.note });
      clearCache("leads_list");
      return `📝 Note added to **${res.data.name}**`;
    }
    case "stopCampaign": {
      const res = await axios.post(`/campaigns/${args.campaignId}/stop`);
      await logToScheduleChannel(
        message.client,
        guildId,
        "⏸️ Campaign Paused",
        `**${res.data.name}** — ${res.data.sent} sent, ${res.data.remaining} not sent.`,
        EMBED_COLORS.DELETE
      );
      return `⏸️ Campaign **${res.data.name}** paused — ${res.data.sent} sent, ${res.data.remaining} not sent.`;
    }
    default:
      return "⚠️ Unsupported operation.";
  }
}

// =================== Main Handler ===================
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (message.mentions.everyone) return;
    const msgClient = message.client;
    const isDM = message.channel.type === ChannelType.DM;
    const isMentioned = message.mentions.has(msgClient.user);
    if (!isDM && !isMentioned) return;

    let userMessage = message.content;
    if (isMentioned) {
      userMessage = userMessage.replace(new RegExp(`<@!?${msgClient.user.id}>`, "g"), "").trim();
    }

    // Voice note processing
    const audioAttachment = message.attachments.find(
      (a) => a.contentType && a.contentType.startsWith("audio/")
    );
    if (audioAttachment && aai) {
      await message.channel.sendTyping();
      const statusMsg = await message.reply("🎙️ **Processing voice message...**");
      try {
        const transcript = await aai.transcripts.transcribe({ audio: audioAttachment.url });
        if (transcript.error) throw new Error(transcript.error);
        if (!transcript.text) throw new Error("No clear speech detected.");
        userMessage = transcript.text;
        await statusMsg.edit(
          `📝 **Transcription:** "${userMessage}"\n⏳ **Generating response...**`
        );
      } catch (err) {
        console.error("AssemblyAI Error:", err);
        await statusMsg.edit(
          "❌ **Could not understand the voice note. Please try again or type your message.**"
        );
        return;
      }
    }

    // Image processing (Vision)
    const imageAttachments = message.attachments.filter(
      (a) => a.contentType && a.contentType.startsWith("image/")
    );
    let imageBlocks = [];
    if (imageAttachments.size > 0) {
      await message.channel.sendTyping();
      const statusMsg = await message.reply("👀 **Looking at the image...**");
      try {
        for (const [id, attachment] of imageAttachments) {
          const response = await fetch(attachment.url);
          const arrayBuffer = await response.arrayBuffer();
          const base64Data = Buffer.from(arrayBuffer).toString("base64");
          let mediaType = attachment.contentType;
          if (mediaType === "image/jpg") mediaType = "image/jpeg";
          if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
            imageBlocks.push({
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            });
          }
        }
        await statusMsg.delete();
      } catch (err) {
        console.error("Image Processing Error:", err);
        await statusMsg.edit("❌ **Could not process the image.**");
      }
    }

    if (!userMessage && imageBlocks.length === 0) return;
    cleanupExpired();

    // Identity & Tenant Resolution
    let manager;
    let workspaceId;
    try {
      const empRes = await axios.get(`/employees/external/${message.author.id}`);
      manager = empRes.data;
      workspaceId = manager.workspaceId; // The API must return the workspaceId for the employee
      if (!["Admin", "Manager"].includes(manager.role?.name)) {
        return message.reply("❌ Sorry, this assistant is for management only.");
      }
    } catch (err) {
      return message.reply("❌ Your platform account is not linked to the system.");
    }

    // Wrap the rest of the execution in the tenant context
    const run = (fn) => runWithTenant(workspaceId, fn);

    return run(async () => {
      // Pending Confirmation
      const pending = pendingActions.get(message.author.id);
      if (pending) {
        const text = userMessage.toLowerCase().trim();
        if (pending.expiresAt < Date.now()) {
          pendingActions.delete(message.author.id);
        } else if (CONFIRM_WORDS.some((word) => text.includes(word))) {
          pendingActions.delete(message.author.id);
          try {
            const resultMsg = await executeAction(
              pending.call,
              pending.call.args,
              manager,
              message
            );
            return message.reply(resultMsg);
          } catch (error) {
            console.error("DM AI Execute Error:", error);
            return message.reply(
              `❌ Operation failed: ${error.response?.data?.error || error.message}`
            );
          }
        } else if (CANCEL_WORDS.some((word) => text.includes(word))) {
          pendingActions.delete(message.author.id);
          return message.reply("🚫 Operation cancelled.");
        } else {
          return message.reply(
            "⏳ You have a pending action. Type **confirm** to proceed or **cancel** to abort, or react with ✅/❌ on the confirmation message."
          );
        }
      }

      await message.channel.sendTyping();
      try {
        const ws = await getWorkspace(workspaceId).catch(() => null);
        const aiConfig = resolveAiConfig(ws);
        if (!aiConfig) {
          return message.reply(
            "❌ The AI assistant is not configured for this workspace. The system owner can add an API key via `/config setup` → 🤖 AI."
          );
        }
        const client = createAiClient(aiConfig);

        const [tasksData, apptsData, eventsData, leadsData, empsData, invsData, campaignsData] =
          await Promise.all([
            getCachedData("all_tasks", "/tasks"),
            getCachedData("appointments_list", "/calendar/appointments"),
            getCachedData("events_list", "/calendar/events"),
            getCachedData("leads_list", "/crm/leads"),
            getCachedData("employees_list", "/employees"),
            getCachedData("invoices_list", "/invoices"),
            getCachedData("campaigns_list", "/campaigns?limit=10"),
          ]);

        const emps = empsData.map((e) => ({ id: e.id, name: e.name, role: e.role?.name }));
        const tasks = tasksData.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate,
        }));
        const appts = apptsData.map((a) => ({
          id: a.id,
          title: a.title || a.subject,
          assignee: a.assignee?.name,
          startTime: a.startTime,
        }));
        const events = eventsData.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          startDate: e.startDate,
        }));
        const leads = leadsData.map((l) => ({ id: l.id, name: l.name, status: l.status }));
        const actualInvs = invsData?.invoices || invsData || [];
        const invs = actualInvs.map((i) => ({
          id: i.id,
          customerName: i.customerName || i.name,
          category: i.category || i.activityType,
          amount: i.netAmount || i.amount,
          status: i.status,
        }));
        const campaigns = (campaignsData || []).map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          sent: c.sent,
          total: c.total,
        }));

        const dataMaps = {
          empById: new Map(emps.map((e) => [e.id, e])),
          taskById: new Map(tasks.map((t) => [t.id, t])),
          apptById: new Map(appts.map((a) => [a.id, a])),
          eventById: new Map(events.map((e) => [e.id, e])),
          leadById: new Map(leads.map((l) => [l.id, l])),
          invById: new Map(invs.map((i) => [i.id, i])),
          campaignById: new Map(campaigns.map((c) => [c.id, c])),
        };

        const tz = resolveTimeZone();
        const now = new Date();
        const currentTime = now.toLocaleString("en-US", { timeZone: tz });
        const currentDay = now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
        const orgName = ws?.organizationName || "Omni-Ops";

        const systemPrompt = `You are an Executive AI System Manager for the "${orgName}" workspace.
CURRENT TIME: ${currentDay}, ${currentTime} (workspace timezone: ${tz})
DATA (internal use with tools only — never print IDs to the user):
Employees: ${JSON.stringify(emps)}
Tasks: ${JSON.stringify(tasks)}
Appointments: ${JSON.stringify(appts)}
Events: ${JSON.stringify(events)}
Leads: ${JSON.stringify(leads)}
Invoices: ${JSON.stringify(invs)}
Campaigns: ${JSON.stringify(campaigns)}
RULES:
Always reply in the SAME language as the user's message. Auto-detect.
Never show IDs in your replies — IDs are for tool use only.
All stored times are UTC — convert to the workspace timezone when displaying.
You are speaking directly in DMs with: ${manager.name}. Be conversational and helpful.
Use the appropriate tool based on the request.
EMPLOYEE NAME MATCHING: The "Employees" list above is the single source of truth. Match names case-insensitively. Partial matches are enough.
REPEATED SCHEDULES: Use the 'dates' parameter for multiple days.
CAMPAIGNS: you can stop a running campaign and report on any campaign, but you cannot create or send one.
BE CONCISE: keep replies under 1500 characters.
You cannot delete leads, employees or invoices — tell the user to use /lead delete, and do not offer a status change as a substitute.
`;

        let history = conversationHistory.get(message.author.id) || [];
        if (
          history.length > 0 &&
          history._lastUpdate &&
          Date.now() - history._lastUpdate > HISTORY_TIMEOUT_MS
        ) {
          history = [];
        }

        let messageContent = [];
        if (imageBlocks.length > 0) messageContent.push(...imageBlocks);
        if (userMessage) messageContent.push({ type: "text", text: userMessage });
        else if (imageBlocks.length > 0)
          messageContent.push({ type: "text", text: "Please analyze this image." });

        history.push({ role: "user", content: messageContent });
        if (history.length > HISTORY_MAX_TURNS)
          history = history.slice(history.length - HISTORY_MAX_TURNS);
        const messages = [...history];

        for (let turn = 0; turn < 5; turn++) {
          const response = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages,
          });

          if (response.stop_reason === "end_turn") {
            const textBlock = response.content.find((b) => b.type === "text");
            if (textBlock?.text) {
              history.push({ role: "assistant", content: textBlock.text });
              const ts = Date.now();
              history = history.map((m) => {
                if (Array.isArray(m.content)) {
                  return {
                    ...m,
                    content: m.content.map((b) =>
                      b.type === "image" ? { type: "text", text: "[User sent an image]" } : b
                    ),
                  };
                }
                return m;
              });
              history._lastUpdate = ts;
              conversationHistory.set(message.author.id, history);
              await message.reply(textBlock.text);
            }
            return;
          }

          if (response.stop_reason === "tool_use") {
            const toolUseBlock = response.content.find((b) => b.type === "tool_use");
            if (!toolUseBlock) break;
            if (MUTATING_TOOLS.has(toolUseBlock.name)) {
              const toolCall = { name: toolUseBlock.name, args: toolUseBlock.input };
              const validation = await validateActionIds(
                toolCall,
                toolCall.args,
                dataMaps,
                message
              );
              if (validation !== true) return message.reply(`❌ ${validation}`);

              const description = describeAction(toolCall, toolCall.args, dataMaps);
              const confirmEmbed = new EmbedBuilder()
                .setColor(EMBED_COLORS.UPDATE || "#FEE75C")
                .setTitle("⚠️ Action Confirmation Required")
                .setDescription(
                  `${description}\n\n👇 Reply with **confirm** or react ✅ to approve, or **cancel** / ❌ to abort.\n⏳ Valid for 2 minutes.`
                )
                .setFooter({ text: `Requested: ${userMessage.substring(0, 100)}` })
                .setTimestamp();
              const sentMessage = await message.reply({ embeds: [confirmEmbed] });
              try {
                await sentMessage.react("✅");
                await sentMessage.react("❌");
              } catch (err) {}

              pendingActions.set(message.author.id, {
                call: toolCall,
                manager,
                workspaceId, // Store workspaceId for the reaction handler
                channelId: message.channel.id,
                confirmMessageId: sentMessage.id,
                expiresAt: Date.now() + CONFIRM_TIMEOUT_MS,
              });
              return;
            }
          }
          break;
        }
        return message.reply("🤔 I couldn't complete that request. Could you rephrase it?");
      } catch (error) {
        console.error("DM AI Error:", error.response?.data?.error || error.message);
        if (error.status === 429)
          return message.reply("⚠️ Rate limit reached. Please wait a moment and try again.");
        if (error.status === 529 || error.status === 503)
          return message.reply(
            "⏳ AI servers are under heavy load. Please try again in a few seconds."
          );
        return message.reply(
          "❌ An error occurred while processing your request. Please try again."
        );
      }
    });
  },
  pendingActions,
  CONFIRM_TIMEOUT_MS,
  executeAction,
};

async function logToScheduleChannel(
  client,
  guildId,
  title,
  description,
  color = EMBED_COLORS.CREATE
) {
  try {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();
    await notifyScheduleChannel(client, guildId, embed);
  } catch (err) {
    console.error("⚠️ Failed to log to schedule channel:", err);
  }
}

async function logToBillingChannel(
  client,
  guildId,
  title,
  description,
  color = EMBED_COLORS.CREATE
) {
  try {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();
    await notifyBillingChannel(client, guildId, embed);
  } catch (err) {
    console.error("⚠️ Failed to log to billing channel:", err);
  }
}
