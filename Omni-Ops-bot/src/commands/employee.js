const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("../utils/axiosInstance");
const { requireRole, MANAGEMENT_ROLES } = require("../utils/requireRole");
const EMBED_COLORS = require("../utils/embedColors");
const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
const { sendLog } = require("../utils/logger");
const { getCachedData, clearCache } = require("../utils/cache");

module.exports = {
  data: new SlashCommandBuilder()
    // =================================== employee ===================================
    .setName("employee")
    .setDescription("Employee management")
    // =================================== employee set-admin ===================================
    .addSubcommand((sub) =>
      sub
        .setName("set-admin")
        .setDescription("Promote an employee to Admin (Highly Restricted)")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Select the employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // =================================== employee create ===================================
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create employee")
        .addStringOption((option) =>
          option.setName("name").setDescription("Employee name").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("email").setDescription("Employee email").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("phone").setDescription("Employee phone").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("role")
            .setDescription("Employee role")
            .setRequired(true)
            .addChoices(
              { name: "Admin", value: "Admin" },
              { name: "Manager", value: "Manager" },
              { name: "Agent", value: "Agent" },
              { name: "Sales", value: "Sales" },
              { name: "Support", value: "Support" },
              { name: "Marketing", value: "Marketing" },
              { name: "Freelancer", value: "Freelancer" }
            )
        )
    )
    // =================================== employee list ===================================
    .addSubcommand((sub) => sub.setName("list").setDescription("List employees"))
    // =================================== employee link ===================================
    .addSubcommand((sub) =>
      sub
        .setName("link")
        .setDescription("Link employee to platform user")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("Discord/Platform user").setRequired(true)
        )
    )
    // =================================== employee info ===================================
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Employee information")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // =================================== employee deactivate ===================================
    .addSubcommand((sub) =>
      sub
        .setName("deactivate")
        .setDescription("Deactivate employee")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // =================================== employee stats ===================================
    .addSubcommand((sub) =>
      sub
        .setName("stats")
        .setDescription("Employee statistics")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // =================================== employee edit ===================================
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit employee")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("name").setDescription("New name").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("email").setDescription("New email").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("phone").setDescription("New phone").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("role").setDescription("New role").setRequired(false).setAutocomplete(true)
        )
    )
    // =================================== employee performance ===================================
    .addSubcommand((sub) =>
      sub
        .setName("performance")
        .setDescription("View employee performance")
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Employee")
            .setRequired(false)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    // =================================== employee create ===================================
    if (subcommand === "create") {
      const employee = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!employee) return;

      await interaction.deferReply();
      try {
        const name = interaction.options.getString("name");
        const email = interaction.options.getString("email");
        const phone = interaction.options.getString("phone");
        const roleName = interaction.options.getString("role");

        const rolesResponse = await axios.get(`/roles`);
        const role = rolesResponse.data.find((r) => r.name === roleName);

        if (!role) {
          return interaction.editReply("❌ Role not found.");
        }

        const response = await axios.post(`/employees`, {
          name,
          email,
          phone,
          roleId: role.id,
        });

        clearCache("employees_list");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.CREATE)
          .setTitle("✅ Employee Created")
          .addFields(
            { name: "👤 Name", value: response.data.name },
            { name: "📧 Email", value: response.data.email },
            { name: "📱 Phone", value: response.data.phone },
            { name: "🎭 Role", value: roleName }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await sendLog(
          interaction.client,
          interaction.guildId,
          "👤 Employee Added",
          response.data.name
        );
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to create employee.");
      }
    }
    // =================================== employee list ===================================
    else if (subcommand === "list") {
      const employee = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!employee) return;

      await interaction.deferReply();
      try {
        const response = await axios.get(`/employees`);
        const employees = response.data;

        if (!employees.length) {
          return interaction.editReply("No employees found.");
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle("👥 Omni-Ops Employees")
          .setTimestamp();

        employees.forEach((employee) => {
          const status = employee.isActive ? "🟢" : "🔴";
          embed.addFields({
            name: `${status} ${employee.name}`,
            value: `${employee.role?.name || "No Role"}`,
            inline: false,
          });
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to fetch employees.");
      }
    }
    // =================================== employee link ===================================
    else if (subcommand === "link") {
      const director = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!director) return;

      await interaction.deferReply();
      try {
        const employeeId = interaction.options.getString("employee");
        const user = interaction.options.getUser("user");
        // Links the employee to a platform user ID (e.g., Discord or Slack)
        const response = await axios.patch(`/employees/${employeeId}/link`, {
          externalId: user.id,
        });

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE)
          .setTitle("🔗 Employee Linked")
          .addFields(
            { name: "👤 Employee", value: response.data.name },
            { name: "🎮 Platform User", value: user.tag }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to link employee.");
      }
    }
    // =================================== employee info ===================================
    else if (subcommand === "info") {
      const director = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!director) return;

      await interaction.deferReply();
      try {
        const employeeId = interaction.options.getString("employee");
        const response = await axios.get(`/employees`);
        const employee = response.data.find((e) => e.id === employeeId);

        if (!employee) {
          return interaction.editReply("❌ Employee not found.");
        }

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(`👤 ${employee.name}`)
          .addFields(
            { name: "Email", value: employee.email || "N/A" },
            { name: "Phone", value: employee.phone || "N/A" },
            { name: "Role", value: employee.role?.name || "No Role" },
            { name: "Platform Linked", value: employee.externalId ? "✅ Linked" : "❌ Not Linked" },
            { name: "Status", value: employee.isActive ? "🟢 Active" : "🔴 Inactive" }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to fetch employee.");
      }
    }
    // =================================== employee performance ===================================
    else if (subcommand === "performance") {
      await interaction.deferReply();
      try {
        const selectedEmployee = interaction.options.getString("employee");

        // Changed endpoint to use externalId
        const requesterResponse = await axios.get(
          `/employees/external/${interaction.user.id}`
        );
        const requester = requesterResponse.data;

        let employee;
        if (selectedEmployee) {
          const isManager = ["Admin", "Manager"].includes(requester?.role?.name);
          if (!isManager && selectedEmployee !== requester?.id) {
            return interaction.editReply("❌ You can only view your own performance.");
          }

          const employeesResponse = await axios.get(`/employees`);
          employee = employeesResponse.data.find((e) => e.id === selectedEmployee);

          if (!employee) {
            return interaction.editReply("❌ Employee not found.");
          }
        } else {
          employee = requester;
        }

        const tasksResponse = await axios.get(
          `/tasks/employee/${employee.id}`
        );
        const tasks = tasksResponse.data;

        const total = tasks.length;
        const completed = tasks.filter((t) => t.status === "done").length;
        const late = tasks.filter((t) => t.completedLate).length;
        const totalDelay = tasks.reduce((sum, task) => sum + (task.daysLate || 0), 0);
        const avgDelay = late ? (totalDelay / late).toFixed(1) : 0;
        const completionRate = total ? ((completed / total) * 100).toFixed(1) : 0;
        const lateRate = completed ? (late / completed) * 100 : 0;
        const score = Math.max(0, Math.round(completionRate - lateRate * 0.5 - avgDelay));

        let rating = "🔴 Needs Improvement";
        if (score >= 90) rating = "🏆 Excellent";
        else if (score >= 75) rating = "🟢 Good";
        else if (score >= 60) rating = "🟡 Average";

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(`📊 ${employee.name} Performance`)
          .addFields(
            { name: "📋 Total Tasks", value: String(total), inline: true },
            { name: "🟢 Completed", value: String(completed), inline: true },
            { name: "🔴 Late Tasks", value: String(late), inline: true },
            { name: "📉 Late Rate", value: `${lateRate.toFixed(1)}%`, inline: true },
            { name: "⏱ Avg Delay", value: `${avgDelay} day(s)`, inline: true },
            { name: "📈 Completion Rate", value: `${completionRate}%`, inline: true },
            { name: "⭐ Score", value: `${score}/100`, inline: true },
            { name: "🏅 Rating", value: rating, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ ${error.response?.data?.error || error.message}`);
      }
    }
    // =================================== employee stats ===================================
    else if (subcommand === "stats") {
      const director = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!director) return;

      await interaction.deferReply();
      try {
        const employeeId = interaction.options.getString("employee");
        const employeesResponse = await axios.get(`/employees`);
        const employee = employeesResponse.data.find((e) => e.id === employeeId);

        if (!employee) {
          return interaction.editReply("❌ Employee not found.");
        }

        const tasksResponse = await axios.get(
          `/tasks/employee/${employee.id}`
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
        await interaction.editReply("❌ Failed to load employee statistics.");
      }
    }
    // =================================== employee set-admin ===================================
    else if (subcommand === "set-admin") {
      await interaction.deferReply();

      let isCurrentAdmin = false;
      try {
        const empCheck = await axios.get(
          `/employees/external/${interaction.user.id}`
        );
        if (empCheck.data?.role?.name === "Admin") {
          isCurrentAdmin = true;
        }
      } catch (err) {
        // Fails silently if not linked
      }

      if (!isCurrentAdmin) {
        const noPermEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("❌ Permission Denied")
          .setDescription("Only an existing Admin can assign the Admin role.")
          .setTimestamp();
        return interaction.editReply({ embeds: [noPermEmbed] });
      }

      try {
        const employeeId = interaction.options.getString("employee");
        const rolesResponse = await axios.get(`/roles`);
        const adminRole = rolesResponse.data.find((r) => r.name === "Admin");

        if (!adminRole) {
          const errorEmbed = new EmbedBuilder()
            .setColor(EMBED_COLORS.DELETE)
            .setTitle("❌ Error")
            .setDescription("Admin role not found in the database. Please run the seed script.");
          return interaction.editReply({ embeds: [errorEmbed] });
        }

        const response = await axios.patch(`/employees/${employeeId}/role`, {
          roleId: adminRole.id,
        });

        clearCache("employees_list");

        const successEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS)
          .setTitle("👑 New Admin Assigned")
          .setDescription(`Successfully promoted **${response.data.name}** to the **Admin** role.`)
          .addFields(
            { name: "👤 Name", value: response.data.name, inline: true },
            { name: "🎭 New Role", value: "👑 Admin", inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        await sendLog(
          interaction.client,
          interaction.guildId,
          "👑 Admin Promotion",
          `**${response.data.name}** has been promoted to **Admin** by ${interaction.user.tag}.`
        );
      } catch (error) {
        console.error(error);
        const errorEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("❌ Failed to promote")
          .setDescription(error.response?.data?.error || error.message);
        await interaction.editReply({ embeds: [errorEmbed] });
      }
    }
    // =================================== employee edit ===================================
    else if (subcommand === "edit") {
      const director = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!director) return;

      await interaction.deferReply();
      try {
        const employeeId = interaction.options.getString("employee");
        const name = interaction.options.getString("name");
        const email = interaction.options.getString("email");
        const phone = interaction.options.getString("phone");
        const roleId = interaction.options.getString("role");

        const updateData = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email;
        if (phone) updateData.phone = phone;
        if (roleId) updateData.roleId = roleId;

        if (Object.keys(updateData).length === 0) {
          return interaction.editReply("⚠️ Please provide at least one field to update.");
        }

        const response = await axios.patch(
          `/employees/${employeeId}`,
          updateData
        );

        clearCache("employees_list");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.UPDATE)
          .setTitle("✏️ Employee Updated")
          .addFields({ name: "👤 Employee", value: response.data.name })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to update employee.");
      }
    }
    // =================================== employee edit ===================================
    else if (subcommand === "deactivate") {
      const director = await requireRole(interaction, MANAGEMENT_ROLES);
      if (!director) return;

      await interaction.deferReply();
      try {
        const employeeId = interaction.options.getString("employee");
        const response = await axios.patch(
          `/employees/${employeeId}/deactivate`
        );

        clearCache("employees_list");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.DELETE)
          .setTitle("🚫 Employee Deactivated")
          .addFields({
            name: "👤 Employee",
            value: response.data.name,
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        await sendLog(
          interaction.client,
          interaction.guildId,
          "🚫 Employee Deactivated",
          response.data.name
        );
      } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Failed to deactivate employee.");
      }
    }
  },

  async autocomplete(interaction) {
    await handleGlobalAutocomplete(interaction);
  },
};
