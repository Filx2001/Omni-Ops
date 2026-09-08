// AI tool definitions + date helpers (Slack surface).
// tools/MUTATING_TOOLS are identical to the Discord bot; dedupe lands in Phase 8.
const { parseSlackDateTime } = require("./slackDates");

/** Parses "YYYY-MM-DD HH:MM" in the workspace timezone and returns ISO. */
function getZonedDateStr(str) {
  if (!str) return undefined;
  const parts = String(str).trim().replace("T", " ").split(" ");
  const datePart = parts[0];
  const timePart = parts.slice(1).join(" ") || null;
  const d = parseSlackDateTime(datePart, timePart || "00:00");
  return d ? d.toISOString() : undefined;
}

/** Understands "today", "tomorrow", "next week" in addition to normal dates. */
function parseDueDate(input) {
  if (!input) return undefined;
  const lower = String(input).toLowerCase().trim();
  if (lower === "today" || lower === "tomorrow") {
    const d = parseSlackDateTime(
      lower === "today"
        ? new Date().toISOString().slice(0, 10)
        : new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      "23:59"
    );
    return d ? d.toISOString() : undefined;
  }
  if (lower === "next week") {
    const d = new Date(Date.now() + 7 * 86400000);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  const parsed = new Date(input.replace(" ", "T"));
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  return undefined;
}

// =================== Tools ===================
const tools = [
  // ===== Tasks =====
  {
    name: "createTask",
    description: "Create a new task and assign it to an employee",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        employeeId: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        dueDate: { type: "string", description: "Due date, e.g. '2026-06-25' or 'tomorrow'" },
      },
      required: ["title", "employeeId", "priority"],
    },
  },
  {
    name: "updateTaskStatus",
    description: "Update the status of a task",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["pending", "in_progress", "done", "cancelled"] },
      },
      required: ["taskId", "status"],
    },
  },
  {
    name: "deleteTask",
    description: "Delete a task from the system",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },

  // ===== Appointments =====
  {
    name: "addAppointment",
    description:
      "Add a new appointment to the schedule. Only assigneeId and a date are truly required — title and times are optional (an appointment without times becomes an all-day entry).",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Optional — auto-named from assignee and date if omitted",
        },
        day: { type: "string", description: "Optional — derived from the date if omitted" },
        startTime: { type: "string", description: "YYYY-MM-DD HH:MM" },
        endTime: { type: "string", description: "YYYY-MM-DD HH:MM" },
        assigneeId: { type: "string" },
        location: { type: "string", description: "Room, address or meeting link" },
        dates: {
          type: "string",
          description:
            "OPTIONAL for repeated series: '1-15' or '1,3,7' with optional month '/8'. When set, the appointment repeats on those days; the TIME part of startTime/endTime is used for every day and the date part is ignored.",
        },
      },
      required: ["assigneeId"],
    },
  },
  {
    name: "updateAppointment",
    description: "Update an existing appointment (title, day, time, location, or assignee)",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        title: { type: "string" },
        day: { type: "string" },
        startTime: { type: "string", description: "YYYY-MM-DD HH:MM" },
        endTime: { type: "string", description: "YYYY-MM-DD HH:MM" },
        location: { type: "string", description: "Room, address or meeting link" },
        assigneeId: { type: "string", description: "New assignee id (only if reassigning)" },
      },
      required: ["appointmentId"],
    },
  },
  {
    name: "deleteAppointment",
    description: "Delete an appointment from the schedule",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" } },
      required: ["appointmentId"],
    },
  },

  // ===== Events =====
  {
    name: "createEvent",
    description: "Create a new event in the calendar",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: {
          type: "string",
          enum: ["meeting", "deadline", "milestone", "workshop", "social", "event"],
        },
        startDate: { type: "string", description: "YYYY-MM-DD HH:MM" },
        endDate: { type: "string", description: "YYYY-MM-DD HH:MM" },
        description: { type: "string" },
        assigneeIds: {
          type: "array",
          items: { type: "string" },
          description: "Employee ids assigned to this event (they receive a DM notification)",
        },
        dates: {
          type: "string",
          description:
            "OPTIONAL for repeated day-series: '5-30' or '1,3,7' with optional month '/8'. Each day becomes a separate event; the TIME part of startDate/endDate applies to every day. ALWAYS use this instead of a long startDate→endDate range when the event spans multiple days.",
        },
      },
      required: ["title", "type", "startDate", "endDate"],
    },
  },
  {
    name: "updateEvent",
    description:
      "Update an existing event in the calendar (title, type, dates, description, or assignees)",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        type: {
          type: "string",
          enum: ["meeting", "deadline", "milestone", "workshop", "social", "event"],
        },
        startDate: { type: "string", description: "YYYY-MM-DD HH:MM — only for scope 'single'" },
        endDate: { type: "string", description: "YYYY-MM-DD HH:MM — only for scope 'single'" },
        startTime: {
          type: "string",
          description:
            "New TIME only (e.g. '10am' or '14:30') — use instead of startDate when scope is 'series' or specific dates",
        },
        endTime: { type: "string", description: "New TIME only — pairs with startTime" },
        scope: {
          type: "string",
          description:
            "'single' (default, this day only), 'series' (all days of the series), or specific dates like '10/7/2026,11/7/2026'",
        },
        description: { type: "string" },
        assigneeIds: {
          type: "array",
          items: { type: "string" },
          description: "Employee ids assigned to this event (they receive a DM notification)",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "deleteEvent",
    description: "Delete an event from the calendar",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        scope: {
          type: "string",
          description:
            "'single' (default, this day only), 'series' (all days of the series), or specific dates like '10/7/2026,11/7/2026'",
        },
      },
      required: ["eventId"],
    },
  },

  // ===== Leads =====
  {
    name: "createLead",
    description:
      "Add a new lead manually (phone call, walk-in, social media). Fails if the phone number already exists.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Local (55512345) or international (+15551234567)" },
        name: {
          type: "string",
          description: "Optional — auto-generated from the phone if omitted",
        },
        source: {
          type: "string",
          enum: ["PHONE", "WALK_IN", "WEBSITE", "SOCIAL", "MANUAL"],
          description: "Default: MANUAL",
        },
        notes: { type: "string" },
      },
      required: ["phone"],
    },
  },
  {
    name: "updateLeadStatus",
    description: "Change the status of a CRM lead",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        status: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"] },
      },
      required: ["leadId", "status"],
    },
  },
  {
    name: "assignLead",
    description: "Assign a lead to an employee for follow-up",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        employeeId: { type: "string" },
      },
      required: ["leadId", "employeeId"],
    },
  },
  {
    name: "addLeadNote",
    description: "Add or replace the private note on a lead",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        note: { type: "string" },
      },
      required: ["leadId", "note"],
    },
  },

  // ===== Invoices =====
  {
    name: "createInvoice",
    description:
      "Create a new client invoice. 'amount' is the UNIT price in the workspace currency. Net total is computed automatically as amount × quantity minus discount%.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Client / customer name" },
        category: {
          type: "string",
          enum: ["Workshop", "Course", "Consulting", "Service"],
        },
        amount: { type: "number", description: "Unit price" },
        quantity: { type: "integer", description: "Default: 1" },
        discount: {
          type: "integer",
          description: "Discount percentage: 0, 5, 10, 15, or 20. Default: 0",
        },
        description: { type: "string", description: "Service / item details" },
        status: { type: "string", enum: ["PENDING", "PAID"], description: "Default: PENDING" },
      },
      required: ["customerName", "category", "amount"],
    },
  },
  {
    name: "updateInvoiceStatus",
    description: "Update the payment status of an invoice",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        status: { type: "string", enum: ["PENDING", "PAID", "CANCELLED"] },
      },
      required: ["invoiceId", "status"],
    },
  },

  // ===== Campaigns =====
  // Note: creating & sending campaigns are intentionally NOT available to the AI —
  // campaigns cost money and affect the sender rating, so the /campaign preview
  // is a protection step that cannot be bypassed.
  {
    name: "stopCampaign",
    description:
      "Pause a running WhatsApp campaign immediately. Note: creating and sending campaigns must be done with /campaign — it requires a preview that cannot be skipped.",
    input_schema: {
      type: "object",
      properties: { campaignId: { type: "string" } },
      required: ["campaignId"],
    },
  },

  // ===== Retrieval =====
  {
    name: "getEmployees",
    description:
      "Fetch the list of employees. Use this when you need an employee ID or want to confirm a name.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getTasks",
    description: "Fetch existing tasks. Use this when you need a task ID.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getLeads",
    description: "Fetch CRM leads.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getAppointments",
    description: "Fetch appointments from the schedule.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getEvents",
    description: "Fetch events from the calendar.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getInvoices",
    description: "Fetch invoices and financial records.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getLeadStats",
    description: "Fetch lead counts by status and the conversion rate",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getCampaigns",
    description: "Fetch the campaign history with status, sent counts and reply counts",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getCampaignInfo",
    description: "Fetch live progress and full details of one campaign",
    input_schema: {
      type: "object",
      properties: { campaignId: { type: "string" } },
      required: ["campaignId"],
    },
  },
  {
    name: "getAudience",
    description:
      "Fetch contact base statistics: how many can receive marketing, how many opted out, and activity breakdown",
    input_schema: { type: "object", properties: {} },
  },
];

// Tools that mutate data — these require manager confirmation before execution
const MUTATING_TOOLS = new Set([
  "createTask",
  "updateTaskStatus",
  "deleteTask",
  "addAppointment",
  "updateAppointment",
  "deleteAppointment",
  "createEvent",
  "updateEvent",
  "deleteEvent",
  "createLead",
  "updateLeadStatus",
  "assignLead",
  "addLeadNote",
  "createInvoice",
  "updateInvoiceStatus",
  "stopCampaign",
]);

module.exports = { tools, MUTATING_TOOLS, getZonedDateStr, parseDueDate };
