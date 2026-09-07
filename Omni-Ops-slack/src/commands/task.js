/**
 * /omni-task command: modal-first task management for Slack.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildTaskBlock, buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { parseSlackDateTime, isValidYear } = require("../utils/slackDates");
const { buildCreateTaskModal, buildDeleteTaskModal } = require("../utils/slackModals");
const { sendDm } = require("../utils/slackDm");

const MANAGEMENT_ROLES = ["Admin", "Manager"];

/** Employee record for a Slack user, or null when unregistered. */
async function getEmployeeBySlackId(slackUserId, workspaceId) {
  try {
    const response = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    return response.data || null;
  } catch {
    return null;
  }
}

/** Shows date + time only when a time is actually set. */
function formatDeadline(dateString) {
  if (!dateString) return "No deadline";
  const d = new Date(dateString);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("en-GB")} ${time}`;
}

module.exports = {
  /** Routes /omni-task <subcommand>. */
  async handleTaskCommand({ command, ack, say, client }) {
    await ack();

    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      if (subcommand === "create") {
        const caller = await getEmployeeBySlackId(slackUserId, workspaceId);
        if (!MANAGEMENT_ROLES.includes(caller?.role?.name)) {
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
        const employee = await getEmployeeBySlackId(slackUserId, workspaceId);
        if (!employee) {
          return say({
            text: "Not registered",
            blocks: buildErrorBlock("Run `/omni-employee register` first."),
            response_type: "ephemeral",
          });
        }

        const tasksResponse = await runWithTenant(workspaceId, () =>
          axios.get(`/tasks/employee/${employee.id}`)
        );
        const tasks = (tasksResponse.data || []).slice(0, 10);

        if (!tasks.length) {
          return say({
            text: "No tasks found",
            blocks: buildSuccessBlock("You have no assigned tasks."),
            response_type: "ephemeral",
          });
        }

        const blocks = [
          { type: "header", text: { type: "plain_text", text: "📋 Your Tasks", emoji: true } },
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

        await say({ text: `Showing ${tasks.length} tasks`, blocks, response_type: "ephemeral" });
      } else if (subcommand === "delete") {
        const caller = await getEmployeeBySlackId(slackUserId, workspaceId);
        if (!MANAGEMENT_ROLES.includes(caller?.role?.name)) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock("Only Managers and Admins can delete tasks."),
            response_type: "ephemeral",
          });
        }

        const taskId = args[1];

        // Direct ID path kept for scripts/power users; default is the picker modal
        if (taskId) {
          const response = await runWithTenant(workspaceId, () => axios.delete(`/tasks/${taskId}`));
          return say({
            text: "Task deleted",
            blocks: buildSuccessBlock(`Task *${response.data.title}* has been deleted.`),
            response_type: "ephemeral",
          });
        }

        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildDeleteTaskModal(),
        });
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
                  "• `/omni-task create` — Create a new task\n" +
                  "• `/omni-task list` — View your tasks\n" +
                  "• `/omni-task delete` — Pick a task to delete (or pass an ID)",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Task command error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(
          `Operation failed: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /**
   * Handles task_create_modal submission.
   * The submitting user comes from body.user; view handlers have no `say`,
   * so confirmation is delivered as a DM.
   */
  async handleTaskViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "task_create_modal") return ack();

      const values = view.state.values;
      const title = values.title_block?.title?.value;
      const employeeId = values.employee_block?.employee?.selected_option?.value;
      const priority = values.priority_block?.priority?.selected_option?.value;
      const deadline = values.deadline_block?.deadline?.selected_date;
      const time = values.time_block?.time?.selected_time;
      const description = values.description_block?.description?.value;

      const errors = {};
      if (!title) errors.title_block = "Title is required";
      if (!employeeId) errors.employee_block = "Assignee is required";
      if (!priority) errors.priority_block = "Priority is required";
      if (Object.keys(errors).length) return ack({ response_action: "errors", errors });

      let dueDate = null;
      if (deadline) {
        dueDate = parseSlackDateTime(deadline, time || "00:00");
        if (!dueDate || !isValidYear(dueDate)) {
          return ack({
            response_action: "errors",
            errors: { deadline_block: "Invalid date. Pick a date in the current year or later." },
          });
        }
      }

      let creator;
      try {
        creator = await runWithTenant(workspaceId, () =>
          axios.get(`/employees/external/${userId}`)
        );
      } catch {
        return ack({
          response_action: "errors",
          errors: { title_block: "You are not registered. Run /omni-employee register first." },
        });
      }

      const response = await runWithTenant(workspaceId, () =>
        axios.post(`/tasks`, {
          title,
          description: description || null,
          assignedToId: employeeId,
          createdById: creator.data.id,
          priority,
          dueDate: dueDate ? dueDate.toISOString() : null,
        })
      );

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Task created: ${response.data.title}`,
        blocks: buildTaskBlock(response.data, "create"),
      });
    } catch (error) {
      console.error("Task view submit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { title_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },

  /** Handles task_delete_modal submission. */
  async handleTaskDeleteViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "task_delete_modal") return ack();

      const caller = await getEmployeeBySlackId(userId, workspaceId);
      if (!MANAGEMENT_ROLES.includes(caller?.role?.name)) {
        return ack({
          response_action: "errors",
          errors: { task_block: "Only Managers and Admins can delete tasks." },
        });
      }

      const taskId = view.state.values.task_block?.task_select?.selected_option?.value;
      if (!taskId) {
        return ack({
          response_action: "errors",
          errors: { task_block: "Select a task to delete." },
        });
      }

      const response = await runWithTenant(workspaceId, () => axios.delete(`/tasks/${taskId}`));

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Task deleted: ${response.data.title}`,
        blocks: buildSuccessBlock(`Task *${response.data.title}* has been deleted.`),
      });
    } catch (error) {
      console.error("Task delete view submit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { task_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
