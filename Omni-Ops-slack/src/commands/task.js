/**
 * Task Management Command Handler
 *
 * Handles /omni-task slash command with modal-first UX.
 * Supports: create, list, delete subcommands.
 *
 * @module commands/task
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildTaskBlock, buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { parseSlackDateTime, isValidYear } = require("../utils/slackDates");
const { buildCreateTaskModal } = require("../utils/slackModals");

/**
 * Checks if a Slack user has Manager or Admin role.
 *
 * @param {string} slackUserId - The Slack user ID
 * @param {string} workspaceId - The workspace ID for tenant context
 * @returns {Promise<boolean>} True if user is Manager or Admin
 */
async function checkIsManager(slackUserId, workspaceId) {
  try {
    const response = await runWithTenant(workspaceId, async () => {
      return axios.get(`/employees/external/${slackUserId}`);
    });
    return ["Admin", "Manager"].includes(response.data?.role?.name);
  } catch {
    return false;
  }
}

/**
 * Formats a date for display in Slack messages.
 * Shows date + time if time is set, otherwise date only.
 *
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string
 */
function formatDeadline(dateString) {
  if (!dateString) return "No deadline";
  const d = new Date(dateString);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("en-GB")} ${time}`;
}

module.exports = {
  /**
   * Main slash command handler for /omni-task
   *
   * Routes to appropriate subcommand handler based on user input.
   * Subcommands: create, list, delete
   *
   * @param {Object} params - Command parameters
   * @param {Object} params.command - Slack command object
   * @param {Function} params.ack - Acknowledgment function
   * @param {Function} params.say - Response function
   * @param {Object} params.client - Slack WebClient
   */
  async handleTaskCommand({ command, ack, say, client }) {
    await ack();

    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      /**
       * SUBCOMMAND: create
       * Opens modal for task creation (Manager/Admin only)
       */
      if (subcommand === "create") {
        const isManager = await checkIsManager(slackUserId, workspaceId);

        if (!isManager) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock("Only Managers and Admins can create tasks."),
            response_type: "ephemeral",
          });
        }

        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildCreateTaskModal(),
        });
      } else if (subcommand === "list") {

      /**
       * SUBCOMMAND: list
       * Shows user's assigned tasks
       */
        // Fetch requester's employee record
        const employeeResponse = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${slackUserId}`);
        });

        const employee = employeeResponse.data;

        // Fetch tasks
        const tasksResponse = await runWithTenant(workspaceId, async () => {
          return axios.get(`/tasks/employee/${employee.id}`);
        });

        const tasks = tasksResponse.data.slice(0, 10); // Limit to 10 for readability

        if (!tasks.length) {
          return say({
            text: "No tasks found",
            blocks: buildSuccessBlock("You have no assigned tasks. Great job!"),
            response_type: "ephemeral",
          });
        }

        // Build task list blocks
        const blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "📋 Your Tasks", emoji: true },
          },
          ...tasks.map((task) => ({
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*${task.title}*\n` +
                `Status: ${task.status} | Priority: ${task.priority}\n` +
                `Deadline: ${formatDeadline(task.dueDate)}`,
            },
          })),
        ];

        await say({
          text: `Showing ${tasks.length} tasks`,
          blocks,
          response_type: "ephemeral",
        });
      } else if (subcommand === "delete") {

      /**
       * SUBCOMMAND: delete
       * Deletes a task by ID (Manager/Admin only)
       */
        const isManager = await checkIsManager(slackUserId, workspaceId);

        if (!isManager) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock("Only Managers and Admins can delete tasks."),
            response_type: "ephemeral",
          });
        }

        const taskId = args[1];

        if (!taskId) {
          return say({
            text: "Missing task ID",
            blocks: buildErrorBlock("Usage: `/omni-task delete <task_id>`"),
            response_type: "ephemeral",
          });
        }

        await runWithTenant(workspaceId, async () => {
          await axios.delete(`/tasks/${taskId}`);
        });

        await say({
          text: "Task deleted",
          blocks: buildSuccessBlock(`Task *${taskId}* has been deleted.`),
          response_type: "ephemeral",
        });
      } else {

      /**
       * SUBCOMMAND: Unknown or missing
       */
        await say({
          text: "Unknown subcommand",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "*Available subcommands:*\n" +
                  "• `/omni-task create` — Create a new task\n" +
                  "• `/omni-task list` — View your tasks\n" +
                  "• `/omni-task delete <id>` — Delete a task",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Task command error:", error.message);

      const errorMessage = error.response?.data?.error || error.message;
      await say({
        text: "Error",
        blocks: buildErrorBlock(`Operation failed: ${errorMessage}`),
        response_type: "ephemeral",
      });
    }
  },

  /**
   * Modal submission handler for task creation
   *
   * Processes form data from the create task modal,
   * validates inputs, and creates the task via API.
   *
   * @param {Object} params - View submission parameters
   * @param {Object} params.view - Slack view object containing form data
   * @param {Function} params.ack - Acknowledgment function
   * @param {Function} params.say - Response function
   */
  async handleTaskViewSubmit({ view, ack, say }) {
    const workspaceId = view.team_id;
    const callbackId = view.callback_id;

    try {
      if (callbackId === "task_create_modal") {
        const values = view.state.values;

        // Extract form values
        const title = values.title_block?.title?.value;
        const employeeId = values.employee_block?.employee?.selected_option?.value;
        const priority = values.priority_block?.priority?.selected_option?.value;
        const deadline = values.deadline_block?.deadline?.selected_date;
        const time = values.time_block?.time?.selected_time;
        const description = values.description_block?.description?.value;

        // Validation: Required fields
        const errors = {};
        if (!title) errors.title_block = "Title is required";
        if (!employeeId) errors.employee_block = "Assignee is required";
        if (!priority) errors.priority_block = "Priority is required";

        if (Object.keys(errors).length > 0) {
          return ack({
            response_action: "errors",
            errors,
          });
        }

        // Parse deadline with timezone awareness
        let dueDate = null;
        if (deadline) {
          dueDate = parseSlackDateTime(deadline, time || "00:00");

          if (!dueDate || !isValidYear(dueDate)) {
            return ack({
              response_action: "errors",
              errors: {
                deadline_block: "Invalid date. Please select a valid future date.",
              },
            });
          }
        }

        // Fetch creator's employee record
        const creatorResponse = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${view.user.id}`);
        });
        const creatorId = creatorResponse.data.id;

        // Create task via API
        const response = await runWithTenant(workspaceId, async () => {
          return axios.post(`/tasks`, {
            title,
            description: description || null,
            assignedToId: employeeId,
            createdById: creatorId,
            priority,
            dueDate: dueDate ? dueDate.toISOString() : null,
          });
        });

        const task = response.data;
        const blocks = buildTaskBlock(task, "create");

        // Clear modal and show success
        await ack({ response_action: "clear" });

        await say({
          text: "Task created successfully",
          blocks,
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Task view submit error:", error.message);

      const errorMessage = error.response?.data?.error || error.message;

      await ack({
        response_action: "errors",
        errors: {
          title_block: `API Error: ${errorMessage}`,
        },
      });
    }
  },
};
