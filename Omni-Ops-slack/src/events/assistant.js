/**
 * AI assistant for Slack: @mentions in channels and direct messages.
 * Read-only tools execute immediately; mutating tools require Block Kit confirmation.
 */

const crypto = require("crypto");
const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { createAiClient, defaultModel, defaultBase } = require("../utils/aiGateway");
const { tools, MUTATING_TOOLS, getZonedDateStr, parseDueDate } = require("../utils/aiTools");
const { checkIsManager } = require("../utils/slackPermissions");
const { resolveTimeZone } = require("../utils/slackDates");

const MAX_TURNS = 5;
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const pendingConfirmations = new Map();
const teamCache = new Map();

/** Wall-clock HH:MM of an ISO instant in the workspace timezone. */
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

/** Resolves the workspace id for message events (they carry no team_id). */
async function resolveTeamId(body, client) {
  const fromAuth = body.authorizations?.[0]?.team_id;
  if (fromAuth) return fromAuth;
  if (!teamCache.has("default")) {
    const auth = await client.auth.test();
    teamCache.set("default", auth.team);
  }
  return teamCache.get("default");
}

async function executeTool(toolName, toolInput, employee, issuedByName) {
  let parsedDateToCheck = null;
  if (toolInput.dueDate) parsedDateToCheck = parseDueDate(toolInput.dueDate);
  else if (toolInput.startTime) parsedDateToCheck = getZonedDateStr(toolInput.startTime);
  else if (toolInput.startDate) parsedDateToCheck = getZonedDateStr(toolInput.startDate);
  const { isValidYear } = require("../utils/slackDates");
  if (parsedDateToCheck && !isValidYear(parsedDateToCheck)) {
    return "❌ Error: Cannot schedule or update records in past years.";
  }
  switch (toolName) {
    case "createTask": {
      const { employeeId, ...taskArgs } = toolInput;
      await axios.post("/tasks", {
        ...taskArgs,
        assignedToId: employeeId,
        createdById: employee.id,
        dueDate: taskArgs.dueDate ? parseDueDate(taskArgs.dueDate) : undefined,
      });
      return `✅ Task created successfully: **${toolInput.title}**`;
    }
    case "updateTaskStatus":
      await axios.patch(`/tasks/${toolInput.taskId}/status`, { status: toolInput.status });
      return `✅ Task status updated to **${toolInput.status}**`;
    case "deleteTask":
      await axios.delete(`/tasks/${toolInput.taskId}`);
      return "🗑️ Task deleted successfully.";
    case "addAppointment": {
      const st = wallTime(getZonedDateStr(toolInput.startTime));
      const et = wallTime(getZonedDateStr(toolInput.endTime));
      if (toolInput.dates) {
        const { parseSeriesDates } = require("../utils/slackDates");
        const dateStrs = parseSeriesDates ? parseSeriesDates(toolInput.dates) : null;
        if (!dateStrs || !st || !et) return "❌ Invalid series dates or times.";
        const items = dateStrs.map((dStr) => {
          const s = getZonedDateStr(`${dStr} ${st}`);
          return {
            title: toolInput.title,
            startTime: s,
            endTime: getZonedDateStr(`${dStr} ${et}`),
            assigneeId: toolInput.assigneeId,
            location: toolInput.location || null,
            createdById: employee.id,
          };
        });
        const bulkRes = await axios.post("/calendar/appointments/bulk", { appointments: items });
        return `✅ Scheduled **${bulkRes.data.created?.length || 0}** appointments (series).`;
      }
      const { dates, ...apptArgs } = toolInput;
      await axios.post("/calendar/appointments", {
        ...apptArgs,
        startTime: getZonedDateStr(toolInput.startTime),
        endTime: getZonedDateStr(toolInput.endTime),
        location: toolInput.location || null,
        createdById: employee.id,
      });
      return `✅ Appointment scheduled: **${toolInput.title || "Auto-named"}**`;
    }
    case "updateAppointment": {
      const updatePayload = { ...toolInput };
      delete updatePayload.appointmentId;
      delete updatePayload.dates;
      if (toolInput.startTime) updatePayload.startTime = getZonedDateStr(toolInput.startTime);
      if (toolInput.endTime) updatePayload.endTime = getZonedDateStr(toolInput.endTime);
      await axios.patch(`/calendar/appointments/${toolInput.appointmentId}`, updatePayload);
      return "✅ Appointment updated successfully.";
    }
    case "deleteAppointment":
      await axios.delete(`/calendar/appointments/${toolInput.appointmentId}`);
      return "🗑️ Appointment deleted from schedule.";
    case "createEvent": {
      const { assigneeIds, dates, ...eventArgs } = toolInput;
      await axios.post("/calendar/events", {
        ...eventArgs,
        assigneeIds: assigneeIds || [],
        startDate: getZonedDateStr(toolInput.startDate),
        endDate: getZonedDateStr(toolInput.endDate),
        createdById: employee.id,
      });
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
      const eventPayload = { ...updEventArgs };
      if (scope !== "series") {
        if (toolInput.startDate) eventPayload.startDate = getZonedDateStr(toolInput.startDate);
        if (toolInput.endDate) eventPayload.endDate = getZonedDateStr(toolInput.endDate);
      } else {
        if (startTime) eventPayload.startTime = startTime;
        if (endTime) eventPayload.endTime = endTime;
      }
      if (updAssignees) eventPayload.assigneeIds = updAssignees;
      const updRes = await axios.patch(
        `/calendar/events/${eventId}?scope=${encodeURIComponent(scope || "single")}`,
        eventPayload
      );
      return `✅ Event updated — ${updRes.data?.count || 1} day(s).`;
    }
    case "deleteEvent": {
      const delRes = await axios.delete(
        `/calendar/events/${toolInput.eventId}?scope=${encodeURIComponent(toolInput.scope || "single")}`
      );
      return `🗑️ Deleted ${delRes.data?.count || 1} event day(s).`;
    }
    case "updateLeadStatus":
      await axios.patch(`/crm/leads/${toolInput.leadId}/status`, { status: toolInput.status });
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
      return `✅ **${res.data.name}** assigned to **${res.data.assignedTo?.name || "employee"}**`;
    }
    case "addLeadNote": {
      const res = await axios.patch(`/crm/leads/${toolInput.leadId}/note`, {
        note: toolInput.note,
      });
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
        createdById: employee.id,
        issuedByName,
      });
      return `✅ Invoice INV-${invRes.data.invoiceNumber} created for **${toolInput.customerName}** — Net: **${invRes.data.netAmount}**`;
    }
    case "updateInvoiceStatus":
      await axios.patch(`/invoices/${toolInput.invoiceId}/status`, { status: toolInput.status });
      return `✅ Invoice status updated to **${toolInput.status}**`;
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
        .map((a) => `• ${a.title || "Appointment"} (${a.assignee?.name || "TBA"}) — ID: ${a.id}`)
        .join("\n");
    }
    case "getEvents": {
      const res = await axios.get("/calendar/events");
      return res.data.map((e) => `• ${e.title} — ${e.type} — ID: ${e.id}`).join("\n");
    }
    case "getInvoices": {
      const res = await axios.get("/invoices");
      const list = res.data.invoices || res.data;
      if (!Array.isArray(list) || !list.length) return "No invoices found.";
      return list
        .map((b) => `• ${b.customerName} — ${b.netAmount} — ${b.status} — ID: ${b.id}`)
        .join("\n");
    }
    case "getLeadStats": {
      const res = await axios.get("/crm/leads/stats");
      const s = res.data;
      const rate = s.total ? ((s.byStatus.CONVERTED / s.total) * 100).toFixed(1) : 0;
      return `Total: ${s.total} — Conversion: ${rate}%\nNew: ${s.byStatus.NEW} · Contacted: ${s.byStatus.CONTACTED} · Qualified: ${s.byStatus.QUALIFIED} · Converted: ${s.byStatus.CONVERTED} · Lost: ${s.byStatus.LOST}`;
    }
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
      return `Reachable: ${a.reachable} of ${a.total}\nOpted out: ${a.optedOut} · No phone: ${a.noPhone}\nActive — 7d: ${a.activity.d7} · 30d: ${a.activity.d30} · 60d: ${a.activity.d60}\nOn cooldown: ${a.recentlyMarketed}`;
    }
    default:
      return `❌ Unknown tool: ${toolName}`;
  }
}

async function safeExecute(name, input, employee, issuedByName) {
  try {
    return await executeTool(name, input, employee, issuedByName);
  } catch (err) {
    return `❌ Error: ${err.response?.data?.error || err.message}`;
  }
}

async function fetchAiConfig(workspaceId) {
  const res = await runWithTenant(workspaceId, () =>
    axios.get(`/workspaces/slack/${workspaceId}/ai-config`)
  );
  const cfg = res.data?.aiConfig;
  if (!cfg?.provider || !cfg?.key) return null;
  return {
    provider: cfg.provider,
    model: cfg.model || defaultModel(cfg.provider),
    apiKey: cfg.key,
    baseUrl: cfg.baseUrl || defaultBase(cfg.provider),
  };
}

async function postChunks(client, channel, text, threadTs) {
  const parts = [];
  for (let i = 0; i < text.length; i += 3900) parts.push(text.slice(i, i + 3900));
  for (const part of parts) {
    await client.chat.postMessage({
      channel,
      text: part,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  }
}

/** One agentic pass. Returns { finalText } or { confirmId, summary, count }. */
async function agentLoop(state) {
  while (state.turn < MAX_TURNS) {
    state.turn++;
    const response = await state.ai.messages.create({
      model: state.aiConfig.model,
      max_tokens: 4096,
      system: state.system,
      tools,
      messages: state.messages,
    });
    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return { finalText: textBlock?.text || "✅ Done." };
    }
    state.messages.push({ role: "assistant", content: response.content });
    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    const results = {};
    for (const block of toolBlocks) {
      if (!MUTATING_TOOLS.has(block.name)) {
        results[block.id] = await safeExecute(
          block.name,
          block.input,
          state.employee,
          state.issuedByName
        );
      }
    }
    const mutating = toolBlocks.filter((b) => MUTATING_TOOLS.has(b.name));
    if (mutating.length) {
      const confirmId = crypto.randomUUID();
      pendingConfirmations.set(confirmId, { ...state, results, toolBlocks, at: Date.now() });
      const summary = mutating
        .map((b) => `• \`${b.name}\` ${JSON.stringify(b.input).slice(0, 300)}`)
        .join("\n");
      return { confirmId, summary, count: mutating.length };
    }
    state.messages.push({
      role: "user",
      content: toolBlocks.map((b) => ({
        type: "tool_result",
        tool_use_id: b.id,
        content: results[b.id],
      })),
    });
  }
  return { finalText: "✅ Operation completed." };
}

async function postConfirmation(client, state, outcome) {
  await client.chat.postMessage({
    channel: state.channel,
    ...(state.threadTs ? { thread_ts: state.threadTs } : {}),
    text: "Confirmation required",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🤖 The AI wants to perform *${outcome.count}* change(s):\n${outcome.summary}\n\nApprove?`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "✅ Approve" },
            action_id: `ai_confirm_${outcome.confirmId}`,
          },
          {
            type: "button",
            style: "danger",
            text: { type: "plain_text", text: "❌ Cancel" },
            action_id: `ai_cancel_${outcome.confirmId}`,
          },
        ],
      },
    ],
  });
}

async function startAssistant({ workspaceId, userId, channel, threadTs, question, client }) {
  try {
    const { isManager, employee } = await checkIsManager(userId, workspaceId);
    if (!isManager) {
      return postChunks(
        client,
        channel,
        "❌ The AI assistant is restricted to Admins and Managers.",
        threadTs
      );
    }
    const aiConfig = await fetchAiConfig(workspaceId);
    if (!aiConfig) {
      return postChunks(
        client,
        channel,
        "❌ AI is not configured for this workspace. The owner can set it via `/omni-config` → 🤖 AI.",
        threadTs
      );
    }
    const tz = await runWithTenant(workspaceId, async () => resolveTimeZone());
    const now = new Date();
    const system =
      `You are an Executive AI System Manager for the "Omni-Ops" workspace.\n` +
      `CURRENT TIME: ${now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz })}, ` +
      `${now.toLocaleString("en-US", { timeZone: tz })} (workspace timezone: ${tz})\n` +
      `RULES:\n` +
      `Always reply in the SAME language as the user's message. English → English. Arabic → Arabic. Auto-detect.\n` +
      `Never show IDs in your replies to the user — IDs are for tool use only.\n` +
      `All stored times are UTC — convert to the workspace timezone when displaying.\n` +
      `You are speaking with: ${employee.name}\n` +
      `When you need data (employee ID, task ID, etc.), use the retrieval tools first, then act.\n` +
      `Mutating actions require user confirmation — describe intent clearly when proposing them.\n` +
      `You can delete tasks, appointments and events. You CANNOT delete leads, employees or invoices.`;
    const state = {
      ai: createAiClient(aiConfig),
      aiConfig,
      messages: [{ role: "user", content: question }],
      turn: 0,
      system,
      employee,
      issuedByName: employee.name,
      workspaceId,
      userId,
      channel,
      threadTs,
    };
    const outcome = await runWithTenant(workspaceId, () => agentLoop(state));
    if (outcome.finalText) return postChunks(client, channel, outcome.finalText, threadTs);
    await postConfirmation(client, state, outcome);
  } catch (error) {
    console.error("Assistant error:", error.message);
    await postChunks(client, channel, `❌ AI request failed: ${error.message}`, threadTs).catch(
      () => {}
    );
  }
}

module.exports = {
  /** @Omni-Ops in any channel. */
  async handleAppMention({ event, body, client }) {
    if (event.bot_id || event.subtype) return;
    const workspaceId = await resolveTeamId(body, client);
    const question = (event.text || "").replace(/^(\s*<@[A-Z0-9]+>\s*)+/i, "").trim();
    if (!question) {
      return postChunks(
        client,
        event.channel,
        'Ask me anything, e.g. "create a task for Khaled due tomorrow".',
        event.ts
      );
    }
    await startAssistant({
      workspaceId,
      userId: event.user,
      channel: event.channel,
      threadTs: event.ts,
      question,
      client,
    });
  },

  /** Direct messages to the bot. */
  async handleDirectMessage({ event, body, client }) {
    if (event.bot_id || event.subtype || event.channel_type !== "im") return;
    const question = (event.text || "").trim();
    if (!question) return;
    const workspaceId = await resolveTeamId(body, client);
    await startAssistant({
      workspaceId,
      userId: event.user,
      channel: event.channel,
      threadTs: null,
      question,
      client,
    });
  },

  /** Approve / cancel buttons for mutating tool calls. */
  async handleConfirmation({ body, ack, client, respond }) {
    await ack();
    const [, kind, confirmId] = body.actions[0].action_id.split("_");
    const state = pendingConfirmations.get(confirmId);
    if (!state || Date.now() - state.at > CONFIRM_TTL_MS) {
      pendingConfirmations.delete(confirmId);
      return respond({
        response_type: "ephemeral",
        text: "⌛ This confirmation expired — ask the assistant again.",
      });
    }
    if (body.user?.id !== state.userId) {
      return respond({
        response_type: "ephemeral",
        text: "❌ Only the person who asked can approve this.",
      });
    }
    pendingConfirmations.delete(confirmId);

    const results = { ...state.results };
    for (const block of state.toolBlocks) {
      if (!MUTATING_TOOLS.has(block.name)) continue;
      results[block.id] =
        kind === "confirm"
          ? await runWithTenant(state.workspaceId, () =>
              safeExecute(block.name, block.input, state.employee, state.issuedByName)
            )
          : "❌ Cancelled by the user. Do not retry.";
    }
    state.messages.push({
      role: "user",
      content: state.toolBlocks.map((b) => ({
        type: "tool_result",
        tool_use_id: b.id,
        content: results[b.id],
      })),
    });

    await respond({
      replace_original: true,
      text: kind === "confirm" ? "✅ Approved" : "❌ Cancelled",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              kind === "confirm"
                ? "✅ *Approved* — executing…"
                : "❌ *Cancelled* — nothing was changed.",
          },
        },
      ],
    });

    const outcome = await runWithTenant(state.workspaceId, () => agentLoop(state));
    if (outcome.finalText)
      return postChunks(client, state.channel, outcome.finalText, state.threadTs);
    await postConfirmation(client, state, outcome);
  },
};
