const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildTaskBlock, buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { parseSlackDateTime, isValidYear } = require("../utils/slackDates");
const { buildCreateTaskModal } = require("../utils/slackModals");

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

module.exports = {
  async handleTaskCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      if (subcommand === "create") {
        const isMgr = await checkIsManager(slackUserId, workspaceId);
        if (!isMgr) {
          return say({
            text: "❌ Management only.",
            blocks: buildErrorBlock("❌ Management only."),
            response_type: "ephemeral",
          });
        }
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildCreateTaskModal(),
        });
      } else if (subcommand === "list") {
        const response = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${slackUserId}`);
        });
        const emp = response.data;
        const tasksRes = await runWithTenant(workspaceId, async () => {
          return axios.get(`/tasks/employee/${emp.id}`);
        });
        const tasks = tasksRes.data.slice(0, 10); // Top 10

        if (!tasks.length) {
          return say({
            text: "✅ No tasks found.",
            blocks: buildSuccessBlock("✅ No tasks found."),
            response_type: "ephemeral",
          });
        }

        const blocks = [
          { type: "header", text: { type: "plain_text", text: "📋 Your Tasks", emoji: true } },
          ...tasks.map((t) => ({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${t.title}*\nStatus: ${t.status} | Priority: ${t.priority}\nDeadline: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-GB") : "None"}`,
            },
          })),
        ];
        await say({ text: "Task list", blocks, response_type: "ephemeral" });
      } else if (subcommand === "delete") {
        const isMgr = await checkIsManager(slackUserId, workspaceId);
        if (!isMgr) {
          return say({
            text: "❌ Management only.",
            blocks: buildErrorBlock("❌ Management only."),
            response_type: "ephemeral",
          });
        }
        const taskId = args[1];
        if (!taskId) {
          return say({
            text: "❌ Provide task ID.",
            blocks: buildErrorBlock("❌ Usage: `/omni-task delete <task_id>`"),
            response_type: "ephemeral",
          });
        }
        await runWithTenant(workspaceId, async () => {
          await axios.delete(`/tasks/${taskId}`);
        });
        await say({
          text: "✅ Task deleted.",
          blocks: buildSuccessBlock(`✅ Task *${taskId}* deleted.`),
          response_type: "ephemeral",
        });
      } else {
        await say({
          text: "❌ Unknown subcommand.",
          blocks: buildErrorBlock(
            "❌ Use: `/omni-task create`, `/omni-task list`, or `/omni-task delete <id>`"
          ),
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Task command error:", error.message);
      await say({
        text: "❌ Error",
        blocks: buildErrorBlock(`❌ ${error.response?.data?.error || error.message}`),
        response_type: "ephemeral",
      });
    }
  },

  async handleTaskViewSubmit({ view, ack, say, client }) {
    const workspaceId = view.team_id;
    const callbackId = view.callback_id;

    try {
      if (callbackId === "task_create_modal") {
        const values = view.state.values;
        const title = values.title_block.title.value;
        const employeeId = values.employee_block.employee.selected_option?.value;
        const priority = values.priority_block.priority.selected_option?.value;
        const deadline = values.deadline_block.deadline.selected_date;
        const time = values.time_block.time.selected_time;
        const description = values.description_block.description.value;

        if (!title || !employeeId || !priority) {
          // Acknowledge but show errors inline (Slack best practice)
          return ack({
            response_action: "errors",
            errors: {
              title_block: !title ? "Title is required" : undefined,
              employee_block: !employeeId ? "Assignee is required" : undefined,
              priority_block: !priority ? "Priority is required" : undefined,
            },
          });
        }

        let dueDate = null;
        if (deadline) {
          dueDate = parseSlackDateTime(deadline, time || "00:00");
          if (!dueDate || !isValidYear(dueDate)) {
            return ack({
              response_action: "errors",
              errors: { deadline_block: "Invalid date or past year." },
            });
          }
        }

        // Fetch creator ID
        const creatorRes = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${view.user.id}`);
        });
        const creatorId = creatorRes.data.id;

        // Create task
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

        // Clear modal and send success message
        await ack({ response_action: "clear" });
        await say({ text: "✅ Task created", blocks, response_type: "ephemeral" });
      }
    } catch (error) {
      console.error("Task view submit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { title_block: `API Error: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
