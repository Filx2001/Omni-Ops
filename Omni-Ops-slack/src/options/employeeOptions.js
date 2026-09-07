const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");

async function handleEmployeeOptions({ options, ack, body }) {
  const workspaceId = body.team.id;
  const searchValue = options.value.toLowerCase();

  try {
    const response = await runWithTenant(workspaceId, async () => {
      return axios.get(`/employees`);
    });

    const employees = response.data || [];

    const filtered = employees
      .filter((emp) => emp.name.toLowerCase().includes(searchValue))
      .slice(0, 10);

    const slackOptions = filtered.map((emp) => ({
      text: {
        type: "plain_text",
        text: `${emp.name} (${emp.role?.name || "No Role"})`,
        emoji: true,
      },
      value: emp.id,
    }));

    await ack({ options: slackOptions });
  } catch (error) {
    console.error("❌ Employee options fetch failed:", error.message);
    await ack({ options: [] });
  }
}

module.exports = { handleEmployeeOptions };
