/**
 * Typeahead handlers for task selection in modals.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");

/** Feeds the external_select in the delete-task modal. */
async function handleTaskOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();

  try {
    const response = await runWithTenant(workspaceId, () => axios.get(`/tasks`));
    const tasks = (response.data || [])
      .filter((task) => task.title.toLowerCase().includes(search))
      .slice(0, 25);

    await ack({
      options: tasks.map((task) => ({
        // Slack caps option labels at 75 characters
        text: {
          type: "plain_text",
          text: `${task.title} · ${task.status}`.substring(0, 75),
        },
        value: task.id,
      })),
    });
  } catch (error) {
    console.error("Task options fetch failed:", error.message);
    await ack({ options: [] });
  }
}

module.exports = { handleTaskOptions };
