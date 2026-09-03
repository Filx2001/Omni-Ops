const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { resolveAiConfig, createAiClient } = require("../utils/aiGateway");
const axios = require("../utils/axiosInstance");
const { requireRole, MANAGEMENT_ROLES } = require("../utils/requireRole");
const { clearCache } = require("../utils/cache");
const {
  parseLocalDateTime,
  isValidYear,
  parseSeriesDates,
  resolveTimeZone,
} = require("../utils/dateParser");
const { tools, getZonedDateStr, parseDueDate } = require("../utils/aiTools");
const { getWorkspace } = require("../utils/workspace");

// Extracts the wall-clock "HH:MM" of an ISO instant in the workspace timezone
const wallTime = (iso) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: resolveTimeZone(),
    }).format(new Date(iso));
  } catch {
    return null;
  }
};

// =================== Tool execution ===================
async function executeTool(toolName, toolInput, manager, issuedByName) {
  let parsedDateToCheck = null;
  if (toolInput.dueDate) parsedDateToCheck = parseDueDate(toolInput.dueDate);
  else if (toolInput.startTime) parsedDateToCheck = getZonedDateStr(toolInput.startTime);
  else if (toolInput.startDate) parsedDateToCheck = getZonedDateStr(toolInput.startDate);
  if (parsedDateToCheck && !isValidYear(parsedDateToCheck)) {
    return "❌ Error: Cannot schedule or update records in past years.";
  }

  switch (toolName) {
    case "createTask": {
      const { employeeId, ...taskArgs } = toolInput;
      await axios.post("/tasks", {
        ...taskArgs,
        assignedToId: employeeId,
        createdById: manager.id,
        dueDate: taskArgs.dueDate ? parseDueDate(taskArgs.dueDate) : undefined,
      });
      clearCache("all_tasks");
      return `✅ Task created successfully: **${toolInput.title}**`;
    }
    case "updateTaskStatus":
      await axios.patch(`/tasks/${toolInput.taskId}/status`, { status: toolInput.status });
      clearCache("all_tasks");
      return `✅ Task status updated to **${toolInput.status}**`;
    case "deleteTask":
      await axios.delete(`/tasks/${toolInput.taskId}`);
      clearCache("all_tasks");
      return `🗑️ Task deleted successfully.`;

    case "addAppointment": {
      const st = wallTime(getZonedDateStr(toolInput.startTime));
      const et = wallTime(getZonedDateStr(toolInput.endTime));
      if (toolInput.dates) {
        const dateStrs = parseSeriesDates(toolInput.dates);
        if (!dateStrs || !st || !et) return "❌ Invalid series dates or times.";
        const items = dateStrs.map((dStr) => {
          const s = parseLocalDateTime(dStr, st).date;
          return {
            title: toolInput.title,
            day: s.toLocaleDateString("en-US", { weekday: "long", timeZone: resolveTimeZone() }),
            startTime: s,
            endTime: parseLocalDateTime(dStr, et).date,
            assigneeId: toolInput.assigneeId,
            location: toolInput.location || null,
            createdById: manager.id,
          };
        });
        const bulkRes = await axios.post("/calendar/appointments/bulk", { appointments: items });
        clearCache("appointments_list");
        return `✅ Scheduled **${bulkRes.data.created?.length || 0}** appointments (series).`;
      }
      const { dates, ...apptArgs } = toolInput;
      await axios.post("/calendar/appointments", {
        ...apptArgs,
        startTime: getZonedDateStr(toolInput.startTime),
        endTime: getZonedDateStr(toolInput.endTime),
        location: toolInput.location || null,
        createdById: manager.id,
      });
      clearCache("appointments_list");
      return `✅ Appointment scheduled: **${toolInput.title || "Auto-named"}**`;
    }
    case "updateAppointment": {
      const updatePayload = { ...toolInput };
      delete updatePayload.appointmentId;
      delete updatePayload.dates;
      if (toolInput.startTime) updatePayload.startTime = getZonedDateStr(toolInput.startTime);
      if (toolInput.endTime) updatePayload.endTime = getZonedDateStr(toolInput.endTime);
      await axios.patch(`/calendar/appointments/${toolInput.appointmentId}`, updatePayload);
      clearCache("appointments_list");
      return `✅ Appointment updated successfully.`;
    }
    case "deleteAppointment":
      await axios.delete(`/calendar/appointments/${toolInput.appointmentId}`);
      clearCache("appointments_list");
      return `🗑️ Appointment deleted from schedule.`;

    case "createEvent": {
      const { assigneeIds, dates, ...eventArgs } = toolInput;
      const st = wallTime(getZonedDateStr(toolInput.startDate));
      const et = wallTime(getZonedDateStr(toolInput.endDate));
      if (dates) {
        const dateStrs = parseSeriesDates(dates);
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
        return `✅ Created **${bulkRes.data.created?.length || 0}** event day(s) (series).`;
      }
      await axios.post("/calendar/events", {
        ...eventArgs,
        assigneeIds: assigneeIds || [],
        startDate: getZonedDateStr(toolInput.startDate),
        endDate: getZonedDateStr(toolInput.endDate),
        createdById: manager.id,
      });
      clearCache("events_list");
      return `✅ Event added to calendar: **${toolInput.title}**`;
    }
    case "updateEvent": {
      const {
        assigneeIds: updAssignees,
        eventId,
        scope,
        startTime,
        endTime,
        ...updEventArgs
      } = toolInput;
      const isSeriesScope = scope && scope !== "single";
      const eventPayload = { ...updEventArgs };
      if (isSeriesScope) {
        delete eventPayload.startDate;
        delete eventPayload.endDate;
        if (startTime) eventPayload.startTime = startTime;
        if (endTime) eventPayload.endTime = endTime;
      } else {
        if (toolInput.startDate) eventPayload.startDate = getZonedDateStr(toolInput.startDate);
        if (toolInput.endDate) eventPayload.endDate = getZonedDateStr(toolInput.endDate);
      }
      if (updAssignees) eventPayload.assigneeIds = updAssignees;
      const updRes = await axios.patch(
        `/calendar/events/${eventId}?scope=${encodeURIComponent(scope || "single")}`,
        eventPayload
      );
      clearCache("events_list");
      return `✅ Event updated — ${updRes.data?.count || 1} day(s).`;
    }
    case "deleteEvent": {
      const delRes = await axios.delete(
        `/calendar/events/${toolInput.eventId}?scope=${encodeURIComponent(toolInput.scope || "single")}`
      );
      clearCache("events_list");
      return `🗑️ Deleted ${delRes.data?.count || 1} event day(s).`;
    }

    case "updateLeadStatus":
      await axios.patch(`/crm/leads/${toolInput.leadId}/status`, { status: toolInput.status });
      clearCache("leads_list");
      return `✅ Lead status updated to **${toolInput.status}**`;
    case "createLead": {
      try {
        const leadRes = await axios.post("/crm/leads", {
          phone: toolInput.phone,
          name: toolInput.name,
          source: toolInput.source || "MANUAL",
          notes: toolInput.notes,
          addedByName: issuedByName,
        });
        clearCache("leads_list");
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
      const res = await axios.patch(`/crm/leads/${toolInput.leadId}/assign`, {
        employeeId: toolInput.employeeId,
      });
      clearCache("leads_list");
      return `✅ **${res.data.name}** assigned to **${res.data.assignedTo?.name || "employee"}**`;
    }
    case "addLeadNote": {
      const res = await axios.patch(`/crm/leads/${toolInput.leadId}/note`, {
        note: toolInput.note,
      });
      clearCache("leads_list");
      return `📝 Note added to **${res.data.name}**`;
    }

    case "createInvoice": {
      const invRes = await axios.post("/invoices", {
        customerName: toolInput.customerName,
        category: toolInput.category,
        description: toolInput.description || "",
        amount: toolInput.amount,
        quantity: toolInput.quantity || 1,
        discount: toolInput.discount || 0,
        status: toolInput.status || "PENDING",
        createdById: manager.id,
        issuedByName,
      });
      clearCache("invoices_list");
      return `✅ Invoice INV-${invRes.data.invoiceNumber ?? invRes.data.referenceId} created for **${toolInput.customerName}** — Net: **${invRes.data.netAmount}**`;
    }
    case "updateInvoiceStatus":
      await axios.patch(`/invoices/${toolInput.invoiceId}/status`, { status: toolInput.status });
      clearCache("invoices_list");
      return `✅ Invoice status updated to **${toolInput.status}**`;

    // ===== Retrieval =====
    case "getEmployees": {
      const res = await axios.get("/employees");
      return res.data
        .map((e) => `• ${e.name} (${e.role?.name || "No Role"}) — ID: ${e.id}`)
        .join("\n");
    }
    case "getTasks": {
      const res = await axios.get("/tasks");
      return res.data.map((t) => `• ${t.title} — ${t.status} — ID: ${t.id}`).join("\n");
    }
    case "getLeads": {
      const res = await axios.get("/crm/leads");
      return res.data.map((l) => `• ${l.name} — ${l.status} — ID: ${l.id}`).join("\n");
    }
    case "getAppointments": {
      const res = await axios.get("/calendar/appointments");
      return res.data
        .map(
          (a) =>
            `• ${a.title || a.subject || "Appointment"} (${a.assignee?.name || "TBA"}) — ID: ${a.id}`
        )
        .join("\n");
    }
    case "getEvents": {
      const res = await axios.get("/calendar/events");
      return res.data.map((e) => `• ${e.title} — ${e.type} — ID: ${e.id}`).join("\n");
    }
    case "getInvoices": {
      const res = await axios.get("/invoices");
      const invoicesList = res.data.invoices || res.data;
      if (!Array.isArray(invoicesList) || invoicesList.length === 0) return "No invoices found.";
      return invoicesList
        .map(
          (b) =>
            `• ${b.customerName || b.name || "Unknown"} — ${b.netAmount || b.amount} — ${b.status} — ID: ${b.id}`
        )
        .join("\n");
    }
    case "getLeadStats": {
      const res = await axios.get("/crm/leads/stats");
      const s = res.data;
      const rate = s.total ? ((s.byStatus.CONVERTED / s.total) * 100).toFixed(1) : 0;
      return `Total: ${s.total} — Conversion: ${rate}%\nNew: ${s.byStatus.NEW} · Contacted: ${s.byStatus.CONTACTED} · Qualified: ${s.byStatus.QUALIFIED} · Converted: ${s.byStatus.CONVERTED} · Not Interested: ${s.byStatus.LOST}`;
    }

    // ===== Campaigns =====
    case "stopCampaign": {
      const res = await axios.post(`/campaigns/${toolInput.campaignId}/stop`);
      return `⏸️ Campaign **${res.data.name}** paused — ${res.data.sent} sent, ${res.data.remaining} not sent.`;
    }
    case "getCampaigns": {
      const res = await axios.get("/campaigns?limit=10");
      if (!res.data.length) return "No campaigns yet.";
      return res.data
        .map(
          (c) =>
            `• ${c.name} — ${c.status} — sent ${c.sent}/${c.total} — replies ${c.replies} — ID: ${c.id}`
        )
        .join("\n");
    }
    case "getCampaignInfo": {
      const res = await axios.get(`/campaigns/${toolInput.campaignId}`);
      const c = res.data;
      return `${c.name} — ${c.status}\nTemplate: ${c.templateName}\nSent: ${c.sent}/${c.total} · Failed: ${c.failed} · Deferred: ${c.deferred}\nReplies: ${c.replies}\nTime left: ~${c.etaMinutes} min`;
    }
    case "getAudience": {
      const res = await axios.get("/campaigns/audience");
      const a = res.data;
      return `Reachable: ${a.reachable} of ${a.total}\nOpted out: ${a.optedOut} · No phone: ${a.noPhone}\nActive — 7d: ${a.activity.d7} · 30d: ${a.activity.d30} · 60d: ${a.activity.d60} · older: ${a.activity.older}\nOn cooldown: ${a.recentlyMarketed}`;
    }
    default:
      return `❌ Unknown tool: ${toolName}`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Ask the AI Assistant (Admin Mode) to manage the system")
    .addStringOption((option) =>
      option.setName("question").setDescription("Ask the AI to do anything").setRequired(true)
    ),

  async execute(interaction) {
    const manager = await requireRole(interaction, MANAGEMENT_ROLES);
    if (!manager) return;
    await interaction.deferReply();
    const question = interaction.options.getString("question");

    // Tenant-aware AI key: workspace key first, host fallback second
    const ws = await getWorkspace(interaction.guildId).catch(() => null);
    const aiConfig = resolveAiConfig(ws);
    if (!aiConfig) {
      return interaction.editReply(
        "❌ The AI assistant is not configured for this workspace. The system owner can add an API key via `/config setup` → 🤖 AI."
      );
    }
    const client = createAiClient(aiConfig);

    const userName = interaction.user.globalName || interaction.user.username;
    const tz = resolveTimeZone();
    const now = new Date();
    const currentTime = now.toLocaleString("en-US", { timeZone: tz });
    const currentDay = now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });

    const systemPrompt = `You are an Executive AI System Manager for the "Omni-Ops" workspace.
CURRENT TIME: ${currentDay}, ${currentTime} (workspace timezone: ${tz})
RULES:
Always reply in the SAME language as the user's message. English → English. Arabic → Arabic. Auto-detect.
Never show IDs in your replies to the user — IDs are for tool use only.
All stored times are UTC — convert to the workspace timezone when displaying.
You are speaking with: ${userName} (${manager.name})
When you need data (employee ID, task ID, etc.), use the retrieval tools first, then act.
For destructive actions (delete), always confirm what you're about to do before executing.
You can delete tasks, appointments and events. You CANNOT delete leads, employees or invoices — tell the user to use /lead delete for leads, and never offer a status change as a substitute for deletion.
`;

    try {
      // =================== Agentic loop ===================
      const messages = [{ role: "user", content: question }];
      let finalText = null;
      for (let turn = 0; turn < 5; turn++) {
        const response = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        });

        // Plain text answer — done
        if (response.stop_reason === "end_turn") {
          const textBlock = response.content.find((b) => b.type === "text");
          finalText = textBlock?.text || "✅ Done.";
          break;
        }

        // The model wants to use tools
        if (response.stop_reason === "tool_use") {
          messages.push({ role: "assistant", content: response.content });
          const toolResults = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            let toolResult;
            try {
              toolResult = await executeTool(
                block.name,
                block.input,
                manager,
                interaction.member?.displayName || interaction.user.username
              );
            } catch (err) {
              toolResult = `❌ Error: ${err.response?.data?.error || err.message}`;
            }
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: toolResult });
          }
          messages.push({ role: "user", content: toolResults });
        }
      }
      if (!finalText) finalText = "✅ Operation completed.";

      const embed = new EmbedBuilder()
        .setColor("#7289DA")
        .setAuthor({ name: "Omni-Ops AI", iconURL: interaction.client.user.displayAvatarURL() })
        .setDescription(finalText.substring(0, 4096))
        .setFooter({ text: `${manager.name} • Omni-Ops` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("AI Command Error:", error);
      await interaction.editReply(
        "❌ An error occurred while processing your request. Please try again."
      );
    }
  },
};
