require("dotenv").config();
const { App } = require("@slack/bolt");
const axios = require("./utils/axiosInstance");
const { runWithTenant } = require("./utils/tenantContext");
const installationStore = require("./utils/installationStore");
const { getWorkspace } = require("./utils/workspace");
const configCmd = require("./commands/config");
const employeeCmd = require("./commands/employee");
const teamJoinEvent = require("./events/teamJoin");
const taskCmd = require("./commands/task");
const appointmentCmd = require("./commands/appointment");
const calendarCmd = require("./commands/calendar");
const dashboardCmd = require("./commands/dashboard");
const myCmd = require("./commands/my");
const invoiceCmd = require("./commands/invoice");
const leadsCmd = require("./commands/leads");
const campaignCmd = require("./commands/campaign");
const employeeOptions = require("./options/employeeOptions");
const taskOptions = require("./options/taskOptions");
const calendarOptions = require("./options/calendarOptions");
const invoiceOptions = require("./options/invoiceOptions");
const crmOptions = require("./options/crmOptions");
const { startScheduler } = require("./cron/scheduler");
const { startNotifyServer } = require("./notifyServer");
const assistant = require("./events/assistant");
const SCOPES = [
  "app_mentions:read",
  "channels:join",
  "channels:manage",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "commands",
  "im:history",
  "im:write",
  "reactions:write",
  "team:read",
  "users:read",
  "users:read.email",
];

const useOAuth = !process.env.SLACK_BOT_TOKEN;
const appOptions = {
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
};

if (useOAuth) {
  appOptions.clientId = process.env.SLACK_CLIENT_ID;
  appOptions.clientSecret = process.env.SLACK_CLIENT_SECRET;
  appOptions.stateSecret = process.env.SLACK_STATE_SECRET || "omni-ops-open-source-state";
  appOptions.scopes = SCOPES;
  appOptions.installationStore = installationStore;
} else {
  appOptions.token = process.env.SLACK_BOT_TOKEN;
}

const app = new App(appOptions);
// Warm the workspace cache before every interaction so timezone
// resolution (resolveTimeZone) always sees the tenant's real timezone.
app.use(async ({ body, next }) => {
  const teamId = body.team?.id || body.team_id || body.authorizations?.[0]?.team_id;
  if (teamId) await getWorkspace(teamId).catch(() => {});
  await next();
});
app.command("/omni-ping", async ({ command, ack, say }) => {
  await ack();
  await runWithTenant(command.team_id, async () => {
    const { getWorkspace } = require("./utils/workspace");
    const ws = await getWorkspace(command.team_id);
    await say({
      text: "Pong",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🏓 Pong! Connected to *${ws.organizationName}* _(platform: ${ws.platform})_`,
          },
        },
      ],
      response_type: "ephemeral",
    });
  });
});

app.command("/omni-config", configCmd.handleConfigCommand);
app.action(/^config_/, configCmd.handleConfigAction);
app.view(/^config_modal_/, configCmd.handleConfigViewSubmit);

app.command("/omni-employee", async ({ command, ack, say, client }) => {
  await ack();
  const args = command.text.trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();
  if (subcommand === "link") {
    command.text = args.slice(1).join(" ").trim();
    await employeeCmd.handleEmployeeLink({ command, ack, say, client });
  } else if (subcommand === "register") {
    await employeeCmd.handleEmployeeRegister({ command, ack, say, client });
  } else if (subcommand === "info") {
    await employeeCmd.handleEmployeeInfo({ command, ack, say });
  } else if (subcommand === "set-admin") {
    command.text = args.slice(1).join(" ").trim();
    await employeeCmd.handleEmployeeSetAdmin({ command, ack, say, client });
  } else if (subcommand === "create") {
    await employeeCmd.handleEmployeeCreate({ command, ack, say, client });
  } else if (subcommand === "edit") {
    await employeeCmd.handleEmployeeEdit({ command, ack, say, client });
  } else if (subcommand === "list") {
    await employeeCmd.handleEmployeeList({ command, ack, say });
  } else {
    await say({
      text: "Unknown subcommand",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Available subcommands:*\n" +
              "• `/omni-employee link <email>` — Link a Slack account to an employee record\n" +
              "• `/omni-employee register` — Register yourself (workspace owner becomes Admin)\n" +
              "• `/omni-employee info` — View your employee record\n" +
              "• `/omni-employee create` — Create an employee record\n" +
              "• `/omni-employee edit` — Edit name, email, phone or role\n" +
              "• `/omni-employee list` — Full team roster\n" +
              "• `/omni-employee set-admin <email|@user>` — Promote to Admin (Admin only)",
          },
        },
      ],
      response_type: "ephemeral",
    });
  }
});

app.event("team_join", teamJoinEvent.handleTeamJoin);

app.command("/omni-task", taskCmd.handleTaskCommand);
app.view("task_create_modal", taskCmd.handleTaskViewSubmit);
app.view("task_delete_modal", taskCmd.handleTaskDeleteViewSubmit);
app.view("task_status_modal", taskCmd.handleTaskStatusViewSubmit);
app.view("task_edit_modal", taskCmd.handleTaskEditViewSubmit);
app.view("event_edit_modal", calendarCmd.handleEventEditViewSubmit);
app.view("employee_create_modal", employeeCmd.handleEmployeeCreateSubmit);
app.view("employee_edit_modal", employeeCmd.handleEmployeeEditSubmit);
app.command("/omni-appointment", appointmentCmd.handleAppointmentCommand);
app.view("appointment_create_modal", appointmentCmd.handleAppointmentCreateSubmit);
app.view("appointment_edit_modal", appointmentCmd.handleAppointmentEditSubmit);
app.view("appointment_delete_modal", appointmentCmd.handleAppointmentDeleteSubmit);

app.command("/omni-calendar", calendarCmd.handleCalendarCommand);
app.view("event_create_modal", calendarCmd.handleEventCreateSubmit);
app.view("event_delete_modal", calendarCmd.handleEventDeleteSubmit);

app.command("/omni-dashboard", dashboardCmd.handleDashboardCommand);
app.command("/omni-my", myCmd.handleMyCommand);

app.command("/omni-invoice", invoiceCmd.handleInvoiceCommand);
app.view("invoice_create_modal", invoiceCmd.handleCreateSubmit);
app.view("invoice_status_modal", invoiceCmd.handleStatusSubmit);
app.view("invoice_delete_modal", invoiceCmd.handleDeleteSubmit);
app.view(/^invoice_email_modal:/, invoiceCmd.handleEmailSubmit);
app.action(/^invoice_email_btn:/, invoiceCmd.handleEmailAction);

// Phase 6: CRM and Campaigns
app.command("/omni-leads", leadsCmd.handleLeadCommand);
app.view(/^lead_/, leadsCmd.handleLeadViewSubmit);

app.command("/omni-campaign", campaignCmd.handleCampaignCommand);
app.view(/^campaign_/, campaignCmd.handleCampaignViewSubmit);
// Phase 7: AI assistant
app.event("app_mention", assistant.handleAppMention);
app.message(assistant.handleDirectMessage);
app.action(/^ai_(confirm|cancel)_/, assistant.handleConfirmation);
// Typeahead sources
app.options("employee", employeeOptions.handleEmployeeOptions);
app.options("employee_multi", employeeOptions.handleEmployeeOptions);
app.options("task_select", taskOptions.handleTaskOptions);
app.options("appointment_select", calendarOptions.handleAppointmentOptions);
app.options("event_select", calendarOptions.handleEventOptions);
app.options("invoice", invoiceOptions.handleInvoiceOptions);
app.options("lead_select", crmOptions.handleLeadOptions);
app.options("template", crmOptions.handleTemplateOptions);
app.options("camp", crmOptions.handleCampaignOptions);
app.options("emp", employeeOptions.handleEmployeeOptions);

(async () => {
  if (!useOAuth) {
    try {
      const auth = await app.client.auth.test();
      await runWithTenant(auth.team_id, async () => {
        await axios
          .post("/workspaces", {
            platform: "SLACK",
            workspaceId: auth.team_id,
            organizationName: auth.team?.name || "Slack Workspace",
          })
          .catch(() => {});
        await axios.patch(`/workspaces/slack/${auth.team_id}`, { slackBotUserId: auth.user_id });
      });
      console.log(`Registered Slack workspace ${auth.team_id} with the API`);
    } catch (err) {
      console.error("Could not self-register workspace:", err.message);
    }
  }
  await app.start();
  console.log("Omni-Ops Slack bot is running (Socket Mode)");
  startScheduler(app);
  startNotifyServer(app.client);
})();
