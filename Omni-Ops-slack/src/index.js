require("dotenv").config();
const { App } = require("@slack/bolt");
const axios = require("./utils/axiosInstance");
const { runWithTenant } = require("./utils/tenantContext");
const installationStore = require("./utils/installationStore");

const configCmd = require("./commands/config");
const employeeCmd = require("./commands/employee");
const teamJoinEvent = require("./events/teamJoin");
const taskCmd = require("./commands/task");
const appointmentCmd = require("./commands/appointment");
const calendarCmd = require("./commands/calendar");
const dashboardCmd = require("./commands/dashboard");
const myCmd = require("./commands/my");
const invoiceCmd = require("./commands/invoice");

const employeeOptions = require("./options/employeeOptions");
const taskOptions = require("./options/taskOptions");
const calendarOptions = require("./options/calendarOptions");
const invoiceOptions = require("./options/invoiceOptions");
const { startScheduler } = require("./cron/scheduler");

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
  } else {
    await say({
      text: "Unknown subcommand",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "• `/omni-employee link <email>`\n• `/omni-employee register`\n• `/omni-employee info`\n• `/omni-employee set-admin <email|@user>`",
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

app.command("/omni-appointment", appointmentCmd.handleAppointmentCommand);
app.view("appointment_create_modal", appointmentCmd.handleAppointmentCreateSubmit);
app.view("appointment_edit_modal", appointmentCmd.handleAppointmentEditSubmit);
app.view("appointment_delete_modal", appointmentCmd.handleAppointmentDeleteSubmit);

app.command("/omni-calendar", calendarCmd.handleCalendarCommand);
app.view("event_create_modal", calendarCmd.handleEventCreateSubmit);
app.view("event_delete_modal", calendarCmd.handleEventDeleteSubmit);

// Phase 5: Dashboard, My, Invoices
app.command("/omni-dashboard", dashboardCmd.handleDashboardCommand);
app.command("/omni-my", myCmd.handleMyCommand);

app.command("/omni-invoice", invoiceCmd.handleInvoiceCommand);
app.view("invoice_create_modal", invoiceCmd.handleCreateSubmit);
app.view("invoice_status_modal", invoiceCmd.handleStatusSubmit);
app.view("invoice_delete_modal", invoiceCmd.handleDeleteSubmit);
app.view(/^invoice_email_modal:/, invoiceCmd.handleEmailSubmit);
app.action(/^invoice_email_btn:/, invoiceCmd.handleEmailAction);

app.options("employee", employeeOptions.handleEmployeeOptions);
app.options("employee_multi", employeeOptions.handleEmployeeOptions);
app.options("task_select", taskOptions.handleTaskOptions);
app.options("appointment_select", calendarOptions.handleAppointmentOptions);
app.options("event_select", calendarOptions.handleEventOptions);
app.options("invoice", invoiceOptions.handleInvoiceOptions);

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
})();
