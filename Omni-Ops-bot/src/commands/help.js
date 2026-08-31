const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");

// Roles that have CRM access — broader than management
const CRM_ROLES = ["Admin", "Manager", "Sales", "Support", "Marketing"];
const MANAGEMENT_ROLES = ["Admin", "Manager"];

// ============================================================================
// 📚 Full Command Map
// access: all | crm | manager | admin
// 🔒 in the description means restricted to management even if the category is broader
// ============================================================================
const CATEGORIES = [
  {
    key: "general",
    label: "👤 Personal & General",
    access: "all",
    commands: [
      { cmd: "/ping", desc: "Check if the bot is online" },
      { cmd: "/help", desc: "Show this menu — add `search:` to find a command" },
      { cmd: "/my profile", desc: "View your profile and quick task overview" },
      { cmd: "/my tasks", desc: "View your assigned tasks (filter by period, status, month)" },
      { cmd: "/my appointments", desc: "View your appointment schedule (filter by week/month)" },
      { cmd: "/my calendar", desc: "View upcoming organization events (filter by month)" },
      { cmd: "/my performance", desc: "View your performance score and stats" },
      {
        cmd: "/my reminders",
        desc: "Set how long before tasks, appointments and events you get reminded",
      },
      { cmd: "/task update", desc: "Update your task's status and attach proof" },
    ],
  },
  {
    key: "crm",
    label: "💬 Customers & Leads (CRM)",
    access: "crm",
    commands: [
      { cmd: "/lead list", desc: "View all leads with their status and last message" },
      { cmd: "/lead info", desc: "Full profile and conversation history for one lead" },
      { cmd: "/lead add", desc: "Add a lead manually (phone call, walk-in, social media)" },
      { cmd: "/lead assign", desc: "Assign a lead to an employee" },
      {
        cmd: "/lead status",
        desc: "Move a lead between stages (New → Contacted → Qualified → Converted)",
      },
      { cmd: "/lead note", desc: "Add a private note to a lead" },
      { cmd: "/lead filter", desc: "Filter leads by date range" },
      { cmd: "/lead stats", desc: "Conversion rate and lead counts by status" },
      { cmd: "/lead edit", desc: "🔒 Edit a lead's name or phone" },
      { cmd: "/lead delete", desc: "🔒 Permanently delete a lead" },
      { cmd: "/lead sync", desc: "🔒 Rebuild the Google Sheet from the database" },
    ],
  },
  {
    key: "campaigns",
    label: "📣 WhatsApp Campaigns",
    access: "manager",
    commands: [
      { cmd: "/campaign audience", desc: "Explore your contact base before creating a campaign" },
      { cmd: "/campaign new", desc: "Create a campaign and preview who will receive it" },
      { cmd: "/campaign send", desc: "Start sending a campaign you already previewed" },
      { cmd: "/campaign status", desc: "Live progress of a running campaign" },
      { cmd: "/campaign stop", desc: "Pause a running campaign immediately" },
      { cmd: "/campaign list", desc: "Campaign history with reply counts" },
      { cmd: "/campaign info", desc: "Full details of one campaign" },
    ],
  },
  {
    key: "billing",
    label: "🧾 Invoices & Billing",
    access: "crm",
    commands: [
      { cmd: "/invoice create", desc: "Create a new invoice with automatic discount calculation" },
      {
        cmd: "/invoice list",
        desc: "View invoices with totals (filter by month or invoice number)",
      },
      { cmd: "/invoice status", desc: "Mark an invoice as paid, pending or cancelled" },
    ],
  },
  {
    key: "tasks",
    label: "📋 Task Management",
    access: "manager",
    commands: [
      { cmd: "/task create", desc: "Assign a new task to an employee" },
      { cmd: "/task edit", desc: "Modify an existing task" },
      { cmd: "/task overdue", desc: "Check overdue tasks (filter by employee or priority)" },
      { cmd: "/task history", desc: "View audit logs for a specific task" },
      { cmd: "/task stats", desc: "View task statistics" },
      { cmd: "/task delete", desc: "Delete a task" },
      { cmd: "/dashboard", desc: "Real-time system statistics" },
    ],
  },
  {
    key: "classes_events",
    label: "📅 Appointments & Events",
    access: "manager",
    commands: [
      {
        cmd: "/appointment add",
        desc: "Schedule an appointment — only assignee and date are required",
      },
      { cmd: "/appointment edit", desc: "Edit an appointment (single or a whole repeated series)" },
      { cmd: "/appointment list", desc: "View the upcoming appointment schedule" },
      { cmd: "/appointment delete", desc: "Remove an appointment or a whole series" },
      { cmd: "/calendar create", desc: "Create a new organization event" },
      { cmd: "/calendar list", desc: "List all upcoming events" },
      { cmd: "/calendar edit", desc: "Edit an existing event" },
      { cmd: "/calendar delete", desc: "Delete an event" },
      { cmd: "/calendar sync", desc: "Sync employee emails to Google Calendar" },
    ],
  },
  {
    key: "employees",
    label: "👥 Employee Management",
    access: "manager",
    commands: [
      { cmd: "/employee create", desc: "Add a new employee to the system" },
      { cmd: "/employee list", desc: "Show all employees and their status" },
      { cmd: "/employee link", desc: "Link a platform account (Discord/Slack) to an employee" },
      { cmd: "/employee info", desc: "View detailed info about an employee" },
      { cmd: "/employee edit", desc: "Edit employee details or role" },
      { cmd: "/employee deactivate", desc: "Deactivate an employee" },
      { cmd: "/employee stats", desc: "Task statistics for a specific employee" },
    ],
  },
  {
    key: "ai",
    label: "🤖 AI Assistant",
    access: "manager",
    commands: [
      {
        cmd: "/ai",
        desc: "Just describe what you need in plain language — no command syntax required",
      },
      {
        cmd: "  ↳ can create",
        desc: "Tasks · appointments (single or repeating) · events · invoices",
      },
      {
        cmd: "  ↳ can update",
        desc: "Task status · appointment details · event details · lead status · invoice status",
      },
      {
        cmd: "  ↳ can answer",
        desc: "Questions about employees, tasks, leads, appointments, events and invoices",
      },
    ],
  },
  {
    key: "config",
    label: "⚙️ System Configuration (Restricted)",
    access: "admin",
    commands: [
      { cmd: "/config setup", desc: "Open the interactive control panel (server owner only)" },
      { cmd: "/config view", desc: "View all current workspace settings" },
      { cmd: "/config auto-role", desc: "Role automatically given to new members" },
      { cmd: "/config daily-report", desc: "Turn your own morning brief on or off" },
      {
        cmd: "/employee set-admin",
        desc: "Promote an employee to Admin (highly restricted)",
      },
    ],
  },
  {
    key: "server",
    label: "🛡️ Platform Server Moderation (Restricted)",
    access: "admin",
    commands: [
      { cmd: "/server member timeout", desc: "Timeout a member for a set number of minutes" },
      { cmd: "/server member untimeout", desc: "Remove a timeout" },
      { cmd: "/server member kick", desc: "Kick a member from the server" },
      { cmd: "/server member ban", desc: "Ban a member from the server" },
      { cmd: "/server channel create", desc: "Create a text or voice channel" },
      { cmd: "/server channel edit", desc: "Rename a channel" },
      { cmd: "/server channel delete", desc: "Delete a channel" },
      { cmd: "/server channel lock", desc: "Lock a channel so nobody can post" },
      { cmd: "/server channel unlock", desc: "Unlock a channel" },
      { cmd: "/server category create", desc: "Create a channel category" },
      { cmd: "/server category edit", desc: "Rename a category" },
      { cmd: "/server category delete", desc: "Delete a category" },
      { cmd: "/server messages clear", desc: "Bulk delete up to 100 messages" },
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("View all available commands based on your role")
    .addStringOption((option) =>
      option
        .setName("search")
        .setDescription("Search for a command (e.g. lead, task, campaign, invoice)")
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // Ephemeral
    try {
      const searchQuery = interaction.options.getString("search")?.toLowerCase().trim();

      // Fetch employee data — if not linked, show general commands only
      let employee = null;
      try {
        const response = await axios.get(
          `/employees/external/${interaction.user.id}`
        );
        employee = response.data;
      } catch (err) {
        // User is not linked to an employee profile
      }

      const roleName = employee?.role?.name;
      const hasCrmAccess = CRM_ROLES.includes(roleName);
      const isManager = MANAGEMENT_ROLES.includes(roleName);
      const isServerAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
      const isAdmin = roleName === "Admin";

      // Server owner always sees everything (they are the system owner)
      const isOwner = interaction.user.id === interaction.guild.ownerId;

      const allowedCategories = CATEGORIES.filter((cat) => {
        if (isOwner) return true;
        if (cat.access === "all") return true;
        if (cat.access === "crm") return hasCrmAccess;
        if (cat.access === "manager") return isManager;
        if (cat.access === "admin") return isServerAdmin || isAdmin;
        return false;
      });

      const embed = new EmbedBuilder().setColor(EMBED_COLORS.INFO).setTimestamp();

      // ======================================== 🔍 Search ========================================
      if (searchQuery) {
        const results = [];
        for (const cat of allowedCategories) {
          for (const c of cat.commands) {
            const haystack = `${c.cmd} ${c.desc}`.toLowerCase();
            if (haystack.includes(searchQuery)) {
              results.push({ ...c, category: cat.label });
            }
          }
        }

        if (results.length > 0) {
          embed.setTitle(`🔍 Search Results for "${searchQuery}"`);
          embed.setDescription(`Found **${results.length}** command(s) matching your search.`);

          const grouped = {};
          for (const r of results) {
            if (!grouped[r.category]) grouped[r.category] = [];
            grouped[r.category].push(`> \`${r.cmd}\`\n> ${r.desc}`);
          }

          for (const [category, lines] of Object.entries(grouped)) {
            const value = lines.join("\n\n");
            embed.addFields({
              name: category,
              value: value.length > 1024 ? value.slice(0, 1020) + "..." : value,
            });
          }
        } else {
          embed.setColor(EMBED_COLORS.DELETE);
          embed.setTitle("🔍 No Results Found");
          embed.setDescription(
            `Couldn't find any command matching **"${searchQuery}"** that you have permission to use.\n\n` +
              "Try a broader keyword like `lead`, `task`, `appointment`, `campaign`, `invoice`, or `config`."
          );
        }
        return interaction.editReply({ embeds: [embed] });
      }

      // ======================================== Normal View ========================================
      embed
        .setAuthor({ name: "Omni-Ops Bot", iconURL: interaction.client.user.displayAvatarURL() })
        .setTitle("📖 Help Menu")
        .setDescription(
          (employee
            ? `Welcome back, **${employee.name}**${roleName ? ` · ${roleName}` : ""}! Here's everything you can do 👇`
            : "⚠️ Your platform account is not linked to an employee profile yet, so your access is limited.\n\nAsk a manager to run `/employee link`.") +
            "\n\n💡 *Tip: use* `/help search:<keyword>` *to find a specific command.*" +
            "\n🔒 *marks a command restricted to management.*"
        );

      for (const cat of allowedCategories) {
        const value = cat.commands.map((c) => `\`${c.cmd}\` — ${c.desc}`).join("\n");
        if (value.length <= 1024) {
          embed.addFields({ name: cat.label, value });
        } else {
          const half = Math.ceil(cat.commands.length / 2);
          embed.addFields(
            {
              name: cat.label,
              value: cat.commands
                .slice(0, half)
                .map((c) => `\`${c.cmd}\` — ${c.desc}`)
                .join("\n"),
            },
            {
              name: `${cat.label} (cont.)`,
              value: cat.commands
                .slice(half)
                .map((c) => `\`${c.cmd}\` — ${c.desc}`)
                .join("\n"),
            }
          );
        }
      }

      const totalCommands = allowedCategories.reduce((sum, c) => sum + c.commands.length, 0);
      embed.setFooter({
        text: `${totalCommands} commands across ${allowedCategories.length} categories • Omni-Ops`,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      const errorEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.DELETE)
        .setTitle("❌ Error")
        .setDescription("An error occurred while loading the help menu.");
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
