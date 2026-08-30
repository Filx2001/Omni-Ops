if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require("express");
const prisma = require("./prisma");
const employeeRoutes = require("./modules/employees/employees.routes");
const roleRoutes = require("./modules/roles/roles.routes");
const taskRoutes = require("./modules/tasks/tasks.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const calendarRoutes = require("./modules/calendar/calendar.routes");
const crmRoutes = require("./modules/crm/crm.routes");
const { requireApiKey } = require("./middleware/auth.middleware");
const settingsRoutes = require("./modules/settings/settings.routes");
const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Coding Hub API" });
});

// بنحتفظ بالـ body الخام عشان التحقق من توقيع ميتا
// لازم يكون الـ buffer الأصلي بالظبط — JSON.stringify مش هيطلع نفس الـ HMAC
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ✅ التعديل هنا: حماية كل المسارات بالـ API Key ما عدا مسار الويب هوك بتاع ميتا
app.use((req, res, next) => {
  if (
    req.path === "/crm/whatsapp/webhook" ||
    req.path === "/crm/inbox/callback" ||
    (process.env.NODE_ENV !== "production" && req.path === "/crm/whatsapp/test")
  ) {
    return next(); // اسمح لطلبات ميتا تعدي بدون API Key
  }
  return requireApiKey(req, res, next); // طبق الحماية على باقي السيرفر
});

app.use("/settings", settingsRoutes);
app.use("/employees", employeeRoutes);
app.use("/roles", roleRoutes);
app.use("/tasks", taskRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/calendar", calendarRoutes);
app.use("/crm", crmRoutes);
app.use("/bills", require("./modules/bills/bills.routes"));
app.use("/campaigns", require("./modules/campaigns/campaigns.routes"));
// "::" مهمة — الشبكة الداخلية في Railway بتشتغل على IPv6
app.listen(3000, "::", () => {
  console.log("Server running on port 3000");
  require("./jobs/maintenance").startMaintenance();
  // أي حملة كانت شغالة وقت إعادة التشغيل بتكمّل من حيث وقفت
  require("./modules/campaigns/campaigns.service")
    .resumeRunningCampaigns()
    .catch(() => {});
});
