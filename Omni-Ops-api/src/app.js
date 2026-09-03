if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require("express");

const { requireApiKey, requireWorkspace } = require("./middleware/auth.middleware");

const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Omni-Ops API" });
});

// Public privacy policy page (required by Google to publish the OAuth app)
app.get("/privacy", (req, res) => {
  res.send(`<!doctype html><html><head><title>Omni-Ops Privacy Policy</title></head>
  <body style="font-family:sans-serif;max-width:700px;margin:40px auto;line-height:1.6">
  <h1>Omni-Ops Privacy Policy</h1>
  <p>Omni-Ops is an open-source workspace management bot. We only store the data needed to run your workspace: the settings, employees, tasks, appointments, leads and invoices you create through the bot.</p>
  <p>When you connect Google, we store an <b>encrypted</b> token so the bot can sync <b>your own</b> Sheets and Calendar. We never read, sell or share your data. You can revoke access at any time from your Google account settings — it stops instantly.</p>
  <p>Contact: services2000026@gmail.com</p>
  </body></html>`);
});

// Keep the raw body — Meta's webhook verifies its HMAC signature against it.
// It must be the exact original buffer; JSON.stringify would not produce the same HMAC.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// 1) Internal-key gate — everything except Meta webhooks must come from the bot
app.use((req, res, next) => {
  if (
    req.path === "/crm/whatsapp/webhook" ||
    req.path === "/crm/inbox/callback" ||
    req.path === "/google/connect" ||
    req.path === "/google/callback" ||
    (process.env.NODE_ENV !== "production" && req.path === "/crm/whatsapp/test")
  ) {
    return next(); // Meta requests carry no internal key
  }
  return requireApiKey(req, res, next);
});

// 2) Workspace management — not scoped (this is how workspaces are created/found)
app.use("/workspaces", require("./modules/workspaces/workspaces.routes"));

// 2.5) Google OAuth — public endpoints (browser + Google call these)
app.use("/google", require("./modules/google/google.routes"));

// 3) Tenant scoping — every business module below sees req.workspace
app.use(requireWorkspace);
app.use("/sheets", require("./modules/sheets/sheets.routes"));

app.use("/employees", require("./modules/employees/employees.routes"));
app.use("/roles", require("./modules/roles/roles.routes"));
app.use("/tasks", require("./modules/tasks/tasks.routes"));
app.use("/reminders", requireWorkspace, require("./modules/reminders/reminders.routes"));
app.use("/dashboard", require("./modules/dashboard/dashboard.routes"));
app.use("/calendar", require("./modules/calendar/calendar.routes"));
app.use("/crm", require("./modules/crm/crm.routes"));
app.use("/invoices", require("./modules/invoices/invoices.routes")); // path renamed; service refit comes next
app.use("/campaigns", require("./modules/campaigns/campaigns.routes"));
app.use("/settings/links", require("./modules/links/links.routes"));
// "::" matters — Railway's internal network runs on IPv6
app.listen(3000, "::", () => {
  console.log("Server running on port 3000");
  require("./jobs/maintenance").startMaintenance();
  // Any campaign that was running when the server restarted resumes where it stopped
  require("./modules/campaigns/campaigns.service")
    .resumeRunningCampaigns()
    .catch(() => {});
});
