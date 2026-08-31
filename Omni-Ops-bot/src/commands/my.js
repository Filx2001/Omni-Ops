const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");
const { clearCache } = require("../utils/cache");

// Helper function to format dates
function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("my")
    .setDescription("Your personal workspace (Profile, Tasks, Appointments, Calendar, Reminders)")
    .addSubcommand((sub) =>
      sub.setName("profile").setDescription("View your personal profile and quick stats")
    )
    .addSubcommand((sub) =>
      sub
        .setName("tasks")
        .setDescription("View your assigned tasks")
        .addStringOption((option) =>
          option.setName("search").setDescription("Search task by title").setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Filter tasks")
            .setRequired(false)
            .addChoices(
              { name: "This Week", value: "week" },
              { name: "This Month", value: "month" },
              { name: "Last Month", value: "last_month" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Filter by status")
            .setRequired(false)
            .addChoices(
              { name: "Pending", value: "pending" },
              { name: "In Progress", value: "in_progress" },
              { name: "Done", value: "done" }
            )
        )
        .addIntegerOption((option) =>
          option.setName("month").setDescription("Month (1-12)").setRequired(false)
        )
        .addIntegerOption((option) =>
          option.setName("year").setDescription("Year").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("appointments")
        .setDescription("View your personal appointment schedule")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Filter by a specific time period")
            .setRequired(false)
            .addChoices(
              { name: "📅 This Week", value: "this_week" },
              { name: "📅 Next Week", value: "next_week" },
              { name: "🗓️ This Month", value: "this_month" }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("month")
            .setDescription("Or select a specific month to view")
            .setRequired(false)
            .addChoices(
              { name: "January", value: 0 },
              { name: "February", value: 1 },
              { name: "March", value: 2 },
              { name: "April", value: 3 },
              { name: "May", value: 4 },
              { name: "June", value: 5 },
              { name: "July", value: 6 },
              { name: "August", value: 7 },
              { name: "September", value: 8 },
              { name: "October", value: 9 },
              { name: "November", value: 10 },
              { name: "December", value: 11 }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("calendar")
        .setDescription("View upcoming organization events and your schedule")
        .addIntegerOption((option) =>
          option
            .setName("month")
            .setDescription("Select a specific month to view")
            .setRequired(false)
            .addChoices(
              { name: "January", value: 0 },
              { name: "February", value: 1 },
              { name: "March", value: 2 },
              { name: "April", value: 3 },
              { name: "May", value: 4 },
              { name: "June", value: 5 },
              { name: "July", value: 6 },
              { name: "August", value: 7 },
              { name: "September", value: 8 },
              { name: "October", value: 9 },
              { name: "November", value: 10 },
              { name: "December", value: 11 }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("performance").setDescription("View your performance score and stats")
    )
    .addSubcommand((sub) =>
      sub
        .setName("reminders")
        .setDescription("Global reminder settings for tasks, appointments, and calendar")
        .addStringOption((option) =>
          option
            .setName("unit")
            .setDescription("Hours or Days")
            .setRequired(true)
            .addChoices(
              { name: "Hours", value: "hours" },
              { name: "Days", value: "days" },
              { name: "Off", value: "off" }
            )
        )
        .addIntegerOption((option) =>
          option.setName("value").setDescription("Number").setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // All 'my' commands are ephemeral as they contain personal data
    await interaction.deferReply({ ephemeral: true });

    let employee;
    try {
      const empResponse = await axios.get(
        `/employees/external/${interaction.user.id}`
      );
      employee = empResponse.data;
    } catch (err) {
      return interaction.editReply(
        "❌ Your platform account is not linked to any employee profile."
      );
    }

    try {
      if (subcommand === "profile") {
        let activeTasks = 0,
          overdueTasks = 0,
          doneTasks = 0;
        try {
          const tasksResponse = await axios.get(
            `/tasks/employee/${employee.id}`
          );
          const tasks = tasksResponse.data;
          activeTasks = tasks.filter((t) => ["pending", "in_progress"].includes(t.status)).length;
          doneTasks = tasks.filter((t) => t.status === "done").length;
          overdueTasks = tasks.filter(
            (t) =>
              t.dueDate &&
              new Date(t.dueDate) < new Date() &&
              !["done", "cancelled"].includes(t.status)
          ).length;
        } catch (err) {}

        const reminderText = employee.reminderEnabled
          ? `🔔 On (${employee.reminderValue} ${employee.reminderUnit} before)`
          : "🔕 Off";

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setAuthor({
            name: `${interaction.user.username}'s Profile`,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTitle(`👤 ${employee.name}`)
          .setDescription(`**Role:** ${employee.role?.name || "No Role Assigned"}`)
          .addFields(
            { name: "📧 Email", value: employee.email || "N/A", inline: true },
            { name: "📱 Phone", value: employee.phone || "N/A", inline: true },
            { name: "⏰ Reminders", value: reminderText, inline: true },
            {
              name: "📊 Quick Task Overview",
              value: `🟢 **Done:** ${doneTasks} | 🔵 **Active:** ${activeTasks} | 🚨 **Overdue:** ${overdueTasks}`,
              inline: false,
            }
          )
          .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "tasks") {
        const tasksResponse = await axios.get(
          `/tasks/employee/${employee.id}`
        );
        let filteredTasks = tasksResponse.data;

        const search = interaction.options.getString("search");
        const period = interaction.options.getString("period");
        const status = interaction.options.getString("status");
        const month = interaction.options.getInteger("month");
        const year = interaction.options.getInteger("year");
        const now = new Date();

        if (period === "week") {
          const weekAgo = new Date();
          weekAgo.setDate(now.getDate() - 7);
          filteredTasks = filteredTasks.filter((task) => new Date(task.createdAt) >= weekAgo);
        }
        if (period === "month") {
          filteredTasks = filteredTasks.filter((task) => {
            const date = new Date(task.createdAt);
            return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
          });
        }
        if (period === "last_month") {
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          filteredTasks = filteredTasks.filter((task) => {
            const date = new Date(task.createdAt);
            return (
              date.getMonth() === lastMonth.getMonth() &&
              date.getFullYear() === lastMonth.getFullYear()
            );
          });
        }
        if (search)
          filteredTasks = filteredTasks.filter((task) =>
            task.title.toLowerCase().includes(search.toLowerCase())
          );
        if (status) filteredTasks = filteredTasks.filter((task) => task.status === status);
        if (month)
          filteredTasks = filteredTasks.filter(
            (task) => new Date(task.dueDate || task.createdAt).getMonth() + 1 === month
          );
        if (year)
          filteredTasks = filteredTasks.filter(
            (task) => new Date(task.dueDate || task.createdAt).getFullYear() === year
          );

        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        filteredTasks.sort((a, b) => {
          const aOverdue =
            a.dueDate &&
            new Date(a.dueDate) < new Date() &&
            !["done", "cancelled"].includes(a.status);
          const bOverdue =
            b.dueDate &&
            new Date(b.dueDate) < new Date() &&
            !["done", "cancelled"].includes(b.status);

          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          if (a.status === "done" && b.status !== "done") return 1;
          if (a.status !== "done" && b.status === "done") return -1;
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        });

        filteredTasks = filteredTasks.slice(0, 25);
        if (!filteredTasks.length)
          return interaction.editReply("📭 No tasks assigned matching the criteria.");

        const statusMap = {
          pending: "🟡 Pending",
          in_progress: "🔵 In Progress",
          done: "🟢 Done",
          cancelled: "🔴 Cancelled",
        };
        const priorityMap = {
          low: "🟢 Low",
          medium: "🟡 Medium",
          high: "🟠 High",
          urgent: "🔴 Urgent",
        };

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(`📋 ${employee.name}'s Tasks`)
          .setTimestamp();

        filteredTasks.forEach((task) => {
          const overdue =
            task.dueDate &&
            new Date(task.dueDate) < new Date() &&
            !["done", "cancelled"].includes(task.status);

          embed.addFields({
            name: overdue ? `🚨 ${task.title}` : task.title,
            value: `${statusMap[task.status]} · ${priorityMap[task.priority]} · ⏰ ${task.dueDate ? formatDate(task.dueDate) : "No deadline"}`,
            inline: false,
          });
        });

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "appointments") {
        // Updated endpoint to match new Appointment architecture
        const response = await axios.get(`/calendar/appointments`);
        const targetPeriod = interaction.options.getString("period");
        const targetMonth = interaction.options.getInteger("month");
        const now = new Date();
        const currentYear = now.getFullYear();

        const myAppointments = response.data.filter((a) => a.assigneeId === employee.id);
        let filteredAppointments = [];
        let viewTitle = `📅 Upcoming Schedule (${employee.name})`;

        if (targetPeriod === "this_week" || targetPeriod === "next_week") {
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay());
          startOfWeek.setHours(0, 0, 0, 0);

          if (targetPeriod === "next_week") {
            startOfWeek.setDate(startOfWeek.getDate() + 7);
            viewTitle = `📅 Next Week's Schedule (${employee.name})`;
          } else {
            viewTitle = `📅 This Week's Schedule (${employee.name})`;
          }

          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          filteredAppointments = myAppointments.filter((a) => {
            const appointmentTime = new Date(a.startTime);
            if (targetPeriod === "this_week")
              return appointmentTime >= now && appointmentTime <= endOfWeek;
            return appointmentTime >= startOfWeek && appointmentTime <= endOfWeek;
          });
        } else if (targetPeriod === "this_month") {
          filteredAppointments = myAppointments.filter((a) => {
            const appointmentTime = new Date(a.startTime);
            return (
              appointmentTime >= now &&
              appointmentTime.getMonth() === now.getMonth() &&
              appointmentTime.getFullYear() === currentYear
            );
          });
          viewTitle = `🗓️ This Month's Schedule (${employee.name})`;
        } else if (targetMonth !== null) {
          filteredAppointments = myAppointments.filter((a) => {
            const appointmentTime = new Date(a.startTime);
            return (
              appointmentTime.getMonth() === targetMonth &&
              appointmentTime.getFullYear() === currentYear
            );
          });
          const monthName = new Date(currentYear, targetMonth).toLocaleString("en-US", {
            month: "long",
          });
          viewTitle = `🗓️ Schedule for ${monthName} ${currentYear} (${employee.name})`;
        } else {
          filteredAppointments = myAppointments.filter((a) => new Date(a.endTime) > now);
        }

        filteredAppointments.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        if (!filteredAppointments.length)
          return interaction.editReply(`📭 No appointments found for the selected timeframe.`);

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(viewTitle)
          .setThumbnail(interaction.user.displayAvatarURL())
          .setTimestamp();

        filteredAppointments.slice(0, 15).forEach((a) => {
          const startTs = Math.floor(new Date(a.startTime).getTime() / 1000);
          const endTs = Math.floor(new Date(a.endTime).getTime() / 1000);
          embed.addFields({
            name: `📅 ${a.title || "Appointment"} (${a.day})`,
            value: `📍 **Location:** ${a.location || "TBA"}\n⏰ **Time:** <t:${startTs}:f> to <t:${endTs}:t>\n⏳ **Starts:** <t:${startTs}:R>`,
            inline: false,
          });
        });

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "calendar") {
        const response = await axios.get(`/calendar/events`);
        const targetMonth = interaction.options.getInteger("month");
        const currentYear = new Date().getFullYear();
        let filteredEvents = [];
        let viewTitle = "";

        if (targetMonth !== null) {
          filteredEvents = response.data
            .filter((e) => {
              const eventDate = new Date(e.startDate);
              return (
                eventDate.getMonth() === targetMonth && eventDate.getFullYear() === currentYear
              );
            })
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

          const monthName = new Date(currentYear, targetMonth).toLocaleString("en-US", {
            month: "long",
          });
          viewTitle = `📅 Events in ${monthName} ${currentYear} (${employee.name})`;
        } else {
          filteredEvents = response.data
            .filter((e) => new Date(e.endDate) > new Date())
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
          viewTitle = `📅 Upcoming Events (${employee.name})`;
        }

        if (!filteredEvents.length)
          return interaction.editReply("📭 No organization events found.");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(viewTitle)
          .setThumbnail(interaction.user.displayAvatarURL())
          .setTimestamp();

        filteredEvents.slice(0, 15).forEach((e) => {
          const startTs = Math.floor(new Date(e.startDate).getTime() / 1000);
          const isMine = e.createdById === employee.id ? "👑 *(Organized by you)*" : "";
          const typeEmoji =
            e.type === "meeting"
              ? "🤝"
              : e.type === "exam"
                ? "📝"
                : e.type === "camp"
                  ? "🏕️"
                  : "🎈";

          embed.addFields({
            name: `${typeEmoji} ${e.title} ${isMine}`,
            value: `⏰ **From:** <t:${startTs}:f>\n⏳ **Starts:** <t:${startTs}:R>\n📄 **Details:** ${e.description || "No description"}`,
            inline: false,
          });
        });

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "performance") {
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

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "reminders") {
        const value = interaction.options.getInteger("value");
        const unit = interaction.options.getString("unit");

        if (unit !== "off" && (!value || value <= 0))
          return interaction.editReply("❌ Please enter a valid reminder value.");
        if (unit === "hours" && value > 168)
          return interaction.editReply("❌ Maximum reminder is 168 hours (7 days).");
        if (unit === "days" && value > 30)
          return interaction.editReply("❌ Maximum reminder is 30 days.");

        if (unit === "off") {
          await axios.patch(`/employees/${employee.id}/reminder`, {
            reminderEnabled: false,
            reminderValue: 0,
            reminderUnit: "off",
          });
          return interaction.editReply("🔕 Global reminders disabled.");
        }

        await axios.patch(`/employees/${employee.id}/reminder`, {
          reminderEnabled: true,
          reminderValue: value,
          reminderUnit: unit,
        });

        clearCache("employees_list");

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || "#00FF00")
          .setTitle("⏰ Global Reminder Updated")
          .setDescription(
            `You will automatically be reminded **${value} ${unit}** before any:\n📋 Task Deadline\n📅 Appointment Schedule\n🗓️ Calendar Event`
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        `❌ An error occurred: ${error.response?.data?.error || error.message}`
      );
    }
  },
};
