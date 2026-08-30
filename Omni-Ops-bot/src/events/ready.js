const { startScheduler } = require("../cron/scheduler");
const { startDailyReport } = require("../cron/reportsEngine");

module.exports = {
  name: "clientReady",
  once: true,

  execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    // Start the reminder engine
    startScheduler(client);
    // Start the daily morning report engine
    startDailyReport(client);
  },
};
