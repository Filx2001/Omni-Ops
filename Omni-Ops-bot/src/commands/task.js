const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");
const { clearCache } = require("../utils/cache");
const { parseDate, isValidYear } = require("../utils/dateParser");
const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
const { notifyTask, notifyScheduleChannel } = require("../utils/dmNotifier");
const { sendLog } = require("../utils/logger");
function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB");
}

// Personal tasks = Manager assigned to themselves -> No DM or schedule channel broadcast
const isPersonal = (task) => Boolean(task?.assignedToId) && task.assignedToId === task.createdById;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("task")
    .setDescription("Task management")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create task")
        .addStringOption((option) =>
          option.setName("title").setDescription("Task title").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Assign employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("priority")
            .setDescription("Task priority")
            .setRequired(true)
            .addChoices(
              { name: "Low", value: "low" },
              { name: "Medium", value: "medium" },
              { name: "High", value: "high" },
              { name: "Urgent", value: "urgent" }
            )
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Task description").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("deadline").setDescription("DD/MM OR tomorrow, today").setRequired(false)
        )
        .addAttachmentOption((option) =>
          option.setName("file").setDescription("Task attachment").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("update")
        .setDescription("Update task status")
        .addStringOption((option) =>
          option.setName("task").setDescription("Task").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("New status")
            .setRequired(true)
            .addChoices(
              { name: "Pending", value: "pending" },
              { name: "In Progress", value: "in_progress" },
              { name: "Done", value: "done" },
              { name: "Cancelled", value: "cancelled" }
            )
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Completion note").setRequired(false)
        )
        .addAttachmentOption((option) =>
          option.setName("proof").setDescription("Proof of completion").setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("stats").setDescription("View task statistics"))
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit task")
        .addStringOption((option) =>
          option.setName("task").setDescription("Task").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("title").setDescription("New title").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("New description").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("priority")
            .setDescription("New priority")
            .setRequired(false)
            .addChoices(
              { name: "Low", value: "low" },
              { name: "Medium", value: "medium" },
              { name: "High", value: "high" },
              { name: "Urgent", value: "urgent" }
            )
        )
        .addStringOption((option) =>
          option.setName("deadline").setDescription("DD/MM OR tomorrow, today").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("overdue")
        .setDescription("View overdue tasks")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Filter by employee")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("before").setDescription("Due before date").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("history")
        .setDescription("View task history")
        .addStringOption((option) =>
          option
            .setName("task")
            .setDescription("Select task")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a task")
        .addStringOption((option) =>
          option.setName("task").setDescription("Task").setRequired(true).setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "create") {
      await interaction.deferReply({ ephemeral: true });
      try {
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const creator = employeeResponse.data;
        if (!["Admin", "Manager"].includes(creator.role?.name)) {
          return interaction.editReply("❌ Management only.");
        }

        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const employeeId = interaction.options.getString("employee");
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(employeeId)) {
          return interaction.editReply("❌ Please select an employee from the dropdown list.");
        }

        const employeesResponse = await axios.get(`${process.env.API_URL}/employees`);
        const assignedEmployee = employeesResponse.data.find((e) => e.id === employeeId);
        const priority = interaction.options.getString("priority");
        const attachment = interaction.options.getAttachment("file");
        const deadline = interaction.options.getString("deadline");

        let dueDate = null;
        if (deadline) {
          dueDate = parseDate(deadline);
          if (!dueDate) {
            return interaction.editReply(
              "❌ Invalid date format. You can use 'today', 'tomorrow', or 'DD/MM'."
            );
          }
        }

        // Prevent scheduling in past years
        if (dueDate && !isValidYear(dueDate)) {
          return interaction.editReply("❌ You cannot schedule tasks in past years.");
        }

        const response = await axios.post(`${process.env.API_URL}/tasks`, {
          title,
          description,
          assignedToId: employeeId,
          createdById: creator.id,
          priority,
          dueDate: dueDate || null,
        });

        const task = response.data;
        clearCache("all_tasks");

        // Notify assigned employee
        if (!isPersonal(task) && task.assignedTo?.externalId) {
          await notifyTask(
            interaction.client,
            task.assignedTo.externalId,
            "create",
            task,
            interaction.user.id
          );
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.CREATE)
          .setTitle("✅ Task Created")
          .addFields(
            { name: "📋 Title", value: task.title },
            { name: "🔥 Priority", value: task.priority },
            {
              name: "👤 Assigned To",
              value: assignedEmployee.externalId
                ? `<@${assignedEmployee.externalId}>`
                : assignedEmployee.name,
            },
            {
              name: "⏰ Deadline",
              value: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No deadline",
            },
            ...(attachment
              ? [{ name: "📎 Attachment", value: `[${attachment.name}](${attachment.url})` }]
              : [])
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (!isPersonal(task)) {
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
        }

        await sendLog(
          interaction.client,
          interaction.guildId,
          "📋 Task Created",
          `**${task.title}**\nAssigned To: ${assignedEmployee.name}\nPriority: ${task.priority}`
        );
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
      }
    } else if (subcommand === "update") {
      await interaction.deferReply();
      try {
        const taskId = interaction.options.getString("task");

        // Update protection: Employees can only update their own tasks, Managers can update any
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const currentEmployee = employeeResponse.data;
        const isManager = ["Admin", "Manager"].includes(currentEmployee.role?.name);

        if (!isManager) {
          const myTasksResponse = await axios.get(
            `${process.env.API_URL}/tasks/employee/${currentEmployee.id}`
          );
          const ownsTask = myTasksResponse.data.some((t) => t.id === taskId);
          if (!ownsTask) {
            return interaction.editReply("❌ You can only update the status of your own tasks.");
          }
        }

        const status = interaction.options.getString("status");
        const note = interaction.options.getString("note");
        const proof = interaction.options.getAttachment("proof");

        const response = await axios.patch(`${process.env.API_URL}/tasks/${taskId}/status`, {
          status,
        });
        const task = response.data;
        clearCache("all_tasks");

        if (status === "done") {
          try {
            const employeesResponse = await axios.get(`${process.env.API_URL}/employees`);
            const managers = employeesResponse.data.filter(
              (employee) =>
                ["Admin", "Manager"].includes(employee.role?.name) && employee.externalId
            );
            for (const manager of managers) {
              const user = await interaction.client.users.fetch(manager.externalId);
              const embed = new EmbedBuilder()
                .setColor(EMBED_COLORS.SUCCESS || EMBED_COLORS.CREATE)
                .setTitle("✅ Task Completed")
                .addFields(
                  { name: "📋 Task", value: task.title },
                  { name: "👤 Completed By", value: interaction.user.tag },
                  ...(task.completedLate
                    ? [{ name: "⚠️ Delay", value: `${task.daysLate} day(s) late` }]
                    : []),
                  ...(note ? [{ name: "📝 Note", value: note }] : []),
                  ...(proof ? [{ name: "📎 Proof", value: `[${proof.name}](${proof.url})` }] : [])
                )
                .setTimestamp();
              await user.send({ embeds: [embed] });
            }
          } catch (error) {
            console.log("Failed to notify managers");
          }
        }

        const statusMap = {
          pending: "🟡 Pending",
          in_progress: "🔵 In Progress",
          done: "🟢 Done",
          cancelled: "🔴 Cancelled",
        };

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE)
          .setTitle("✅ Task Updated")
          .addFields(
            { name: "📋 Task", value: task.title },
            { name: "📊 Status", value: statusMap[task.status] },
            ...(task.completedLate
              ? [{ name: "⚠️ Delay", value: `${task.daysLate} day(s) late` }]
              : []),
            ...(note ? [{ name: "📝 Note", value: note }] : []),
            ...(proof
              ? [{ name: "📎 Submitted File", value: `[${proof.name}](${proof.url})` }]
              : [])
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await sendLog(interaction.client, interaction.guildId, "✅ Task Updated", task.title);
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
      }
    } else if (subcommand === "stats") {
      await interaction.deferReply();
      try {
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const employee = employeeResponse.data;
        const tasksResponse = await axios.get(
          `${process.env.API_URL}/tasks/employee/${employee.id}`
        );
        const tasks = tasksResponse.data;

        const total = tasks.length;
        const pending = tasks.filter((t) => t.status === "pending").length;
        const inProgress = tasks.filter((t) => t.status === "in_progress").length;
        const done = tasks.filter((t) => t.status === "done").length;
        const cancelled = tasks.filter((t) => t.status === "cancelled").length;
        const completionRate = total ? ((done / total) * 100).toFixed(1) : 0;

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(`📊 ${employee.name}'s Statistics`)
          .addFields(
            { name: "📋 Total Tasks", value: String(total), inline: true },
            { name: "🟡 Pending", value: String(pending), inline: true },
            { name: "🔵 In Progress", value: String(inProgress), inline: true },
            { name: "🟢 Done", value: String(done), inline: true },
            { name: "🔴 Cancelled", value: String(cancelled), inline: true },
            { name: "📈 Completion Rate", value: `${completionRate}%`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to load statistics.");
      }
    } else if (subcommand === "overdue") {
      await interaction.deferReply();
      try {
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const currentEmployee = employeeResponse.data;
        if (!["Admin", "Manager"].includes(currentEmployee.role?.name)) {
          return interaction.editReply("❌ Management only.");
        }

        const employeesResponse = await axios.get(`${process.env.API_URL}/employees`);
        const employees = employeesResponse.data;
        const employeeId = interaction.options.getString("employee");
        const beforeDate = interaction.options.getString("before");

        let filteredEmployees = employeeId
          ? employees.filter((e) => e.id === employeeId)
          : employees;

        const overdueTasks = [];
        for (const employee of filteredEmployees) {
          const tasksResponse = await axios.get(
            `${process.env.API_URL}/tasks/employee/${employee.id}`
          );
          const tasks = tasksResponse.data;
          tasks
            .filter((task) => {
              if (!task.dueDate || task.status === "done" || task.status === "cancelled")
                return false;
              const dueDate = new Date(task.dueDate);
              if (dueDate >= new Date()) return false;
              if (beforeDate) {
                const filterDate = new Date(beforeDate);
                if (isNaN(filterDate.getTime())) return false;
                return dueDate <= filterDate;
              }
              return true;
            })
            .forEach((task) => {
              overdueTasks.push({
                employee: employee.name,
                title: task.title,
                dueDate: task.dueDate,
              });
            });
        }

        if (!overdueTasks.length) {
          return interaction.editReply("✅ No overdue tasks found.");
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("🚨 Overdue Tasks")
          .setTimestamp();

        overdueTasks.slice(0, 25).forEach((task) => {
          embed.addFields({
            name: `🚨 ${task.title}`,
            value: `👤 ${task.employee}\n⏰ ${formatDate(task.dueDate)}`,
            inline: false,
          });
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to load overdue tasks.");
      }
    } else if (subcommand === "delete") {
      await interaction.deferReply({ ephemeral: true });
      try {
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const employee = employeeResponse.data;
        if (!["Admin", "Manager"].includes(employee.role?.name)) {
          return interaction.editReply("❌ Management only.");
        }

        const taskId = interaction.options.getString("task");
        const response = await axios.delete(`${process.env.API_URL}/tasks/${taskId}`);
        const task = response.data;
        clearCache("all_tasks");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("🗑️ Task Deleted")
          .setDescription("Task moved to deleted records.")
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Notify on task deletion
        if (!isPersonal(task) && task.assignedTo?.externalId) {
          await notifyTask(
            interaction.client,
            task.assignedTo.externalId,
            "delete",
            task,
            interaction.user.id
          );
        }

        if (!isPersonal(task)) {
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
        }
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
      }
    } else if (subcommand === "edit") {
      await interaction.deferReply({ ephemeral: true });
      try {
        // Edit protection: Managers only
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const currentEmployee = employeeResponse.data;
        if (!["Admin", "Manager"].includes(currentEmployee.role?.name)) {
          return interaction.editReply("❌ Management only. You cannot edit task details.");
        }

        const taskId = interaction.options.getString("task");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const employeeId = interaction.options.getString("employee");
        const priority = interaction.options.getString("priority");
        const deadline = interaction.options.getString("deadline");

        const updateData = {};
        if (title) updateData.title = title;
        if (description) updateData.description = description;
        if (employeeId) updateData.assignedToId = employeeId;
        if (priority) updateData.priority = priority;

        if (deadline) {
          const parsedDate = parseDate(deadline);
          if (!parsedDate) {
            return interaction.editReply("❌ Invalid date format.");
          }
          if (!isValidYear(parsedDate)) {
            return interaction.editReply("❌ You cannot change the deadline to a past year.");
          }
          updateData.dueDate = parsedDate;
        }

        const response = await axios.patch(`${process.env.API_URL}/tasks/${taskId}`, updateData);
        clearCache("all_tasks");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE)
          .setTitle("✏️ Task Updated")
          .addFields(
            { name: "📝 Task", value: response.data.title, inline: true },
            {
              name: "👤 Assigned To",
              value: response.data.assignedTo?.name ?? "Not Assigned",
              inline: true,
            },
            { name: "🔥 Priority", value: response.data.priority, inline: true },
            {
              name: "📅 Deadline",
              value: response.data.dueDate ? formatDate(response.data.dueDate) : "No deadline",
              inline: true,
            },
            {
              name: "📄 Description",
              value: response.data.description ?? "No description",
              inline: false,
            }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (!isPersonal(response.data) && response.data.assignedTo?.externalId) {
          await notifyTask(
            interaction.client,
            response.data.assignedTo.externalId,
            "update",
            response.data,
            interaction.user.id
          );
        }

        if (!isPersonal(response.data)) {
          await notifyScheduleChannel(interaction.client, interaction.guildId, embed);
        }
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to update task.");
      }
    } else if (subcommand === "history") {
      await interaction.deferReply();
      const taskId = interaction.options.getString("task");
      try {
        // Must be a manager, or the task must be assigned to the requester
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const currentEmployee = employeeResponse.data;
        const isManager = ["Admin", "Manager"].includes(currentEmployee.role?.name);

        if (!isManager) {
          const myTasksResponse = await axios.get(
            `${process.env.API_URL}/tasks/employee/${currentEmployee.id}`
          );
          const ownsTask = myTasksResponse.data.some((t) => t.id === taskId);
          if (!ownsTask) {
            return interaction.editReply("❌ You can only view the history of your own tasks.");
          }
        }

        const response = await axios.get(`${process.env.API_URL}/tasks/${taskId}/history`);
        const history = response.data;

        if (!history.length) {
          return interaction.editReply("❌ No history found.");
        }

        const created = history.find((item) => item.action === "TASK_CREATED");
        const updates = history.filter((item) => item.action === "TASK_STATUS_UPDATED");
        const task = created?.newValue;

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle("📋 Task History")
          .addFields(
            { name: "📝 Title", value: task?.title ?? "Unknown" },
            { name: "👤 Assigned To", value: task?.assignedTo?.name ?? "Unknown" },
            {
              name: "📅 Created",
              value: `<t:${Math.floor(new Date(created.createdAt).getTime() / 1000)}:F>`,
            }
          )
          .setTimestamp();

        if (updates.length) {
          embed.addFields({
            name: "🔄 Status History",
            value: updates
              .map((update) => `• ${update.oldValue?.status} → ${update.newValue?.status}`)
              .join("\n"),
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to load history.");
      }
    }
  },

  async autocomplete(interaction) {
    await handleGlobalAutocomplete(interaction);
  },
};
