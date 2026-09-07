const axios = require("./axiosInstance");
const { runWithTenant } = require("./tenantContext");

/**
 * Checks if a Slack user has Manager or Admin role.
 */
async function checkIsManager(slackUserId, workspaceId) {
  try {
    const response = await runWithTenant(workspaceId, async () => {
      return axios.get(`/employees/external/${slackUserId}`);
    });

    const employee = response.data;
    const isManager = ["Admin", "Manager"].includes(employee?.role?.name);

    return { isManager, employee };
  } catch (error) {
    // If the user is not found in the system, they are not a manager
    return { isManager: false, employee: null };
  }
}

/**
 * Fetches all employees for autocomplete or assignment
 */
async function getAllEmployees(workspaceId) {
  try {
    const response = await runWithTenant(workspaceId, async () => {
      return axios.get(`/employees`);
    });
    return response.data || [];
  } catch (error) {
    console.error("Failed to fetch employees:", error.message);
    return [];
  }
}

module.exports = {
  checkIsManager,
  getAllEmployees,
};
