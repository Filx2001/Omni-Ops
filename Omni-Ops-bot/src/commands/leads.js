const {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");
const { clearCache } = require("../utils/cache");

// Phone number formatter
function formatPhone(phone) {
  if (!phone) return "N/A";
  const match = phone.match(/^(\+\d{1,3})(\d+)$/);
  return match ? `${match[1]} ${match[2]}` : phone;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lead")
    .setDescription("CRM Leads management")
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("View CRM leads in a clean grid")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Number of leads to show")
            .addChoices(
              { name: "5", value: 5 },
              { name: "10", value: 10 },
              { name: "20", value: 20 },
              { name: "25", value: 25 }
            )
        )
        .addStringOption((option) =>
          option.setName("search").setDescription("Search by name or phone")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Get detailed profile of a specific lead")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search by lead's name or phone number")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("assign")
        .setDescription("Assign a lead to a specific employee")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search lead by name or phone")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("employee")
            .setDescription("Search employee by name")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Update the status of a lead")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search lead by name or phone")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("new_status")
            .setDescription("Select the new status")
            .setRequired(true)
            .addChoices(
              { name: "🆕 New", value: "NEW" },
              { name: "📞 Contacted", value: "CONTACTED" },
              { name: "⭐ Qualified", value: "QUALIFIED" },
              { name: "✅ Converted", value: "CONVERTED" },
              { name: "🚫 Not Interested", value: "LOST" }
            )
        )
    )
    .addSubcommand((sub) => sub.setName("stats").setDescription("View CRM performance analytics"))
    .addSubcommand((sub) =>
      sub.setName("filter").setDescription("Filter leads by date range (opens a pop-up window)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("note")
        .setDescription("Add a private note to a lead")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search lead by name or phone")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("content").setDescription("The note content").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("❌ Delete a lead completely from CRM & Google Sheets")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search lead to delete by name or phone")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("✏️ Edit lead basic details (Name, Phone)")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search lead to edit")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("new_name")
            .setDescription("Type the new name (leave empty to keep current)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("new_phone")
            .setDescription("Type the new phone (leave empty to keep current)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("➕ Add a new lead manually")
        .addStringOption((option) =>
          option
            .setName("phone")
            .setDescription("Phone number (e.g. 55512345 or +15551234567)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Lead name (optional — auto-named from the phone if left empty)")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("source")
            .setDescription("Where this lead came from")
            .setRequired(false)
            .addChoices(
              { name: "📞 Phone Call", value: "PHONE" },
              { name: "🚶 Walk-in", value: "WALK_IN" },
              { name: "🌐 Website", value: "WEBSITE" },
              { name: "📱 Social Media", value: "SOCIAL" },
              { name: "✍️ Other", value: "MANUAL" }
            )
        )
        .addStringOption((option) =>
          option.setName("notes").setDescription("Notes about this lead").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("multi-add")
        .setDescription("📋 Add many phone numbers at once (opens a pop-up window)")
        .addStringOption((option) =>
          option
            .setName("source")
            .setDescription("Where these leads came from")
            .setRequired(true)
            .addChoices(
              { name: "📞 Phone Call", value: "PHONE" },
              { name: "🚶 Walk-in", value: "WALK_IN" },
              { name: "🌐 Website", value: "WEBSITE" },
              { name: "📱 Social Media", value: "SOCIAL" },
              { name: "📥 Imported list", value: "IMPORT" },
              { name: "✍️ Other", value: "MANUAL" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("🔄 Rebuild the Google Sheet from the database")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Modals MUST be shown before any deferReply — Discord requires showModal
    // to be the first response to the interaction.
    if (subcommand === "filter") {
      const modal = new ModalBuilder().setCustomId("filterModal").setTitle("📅 Filter Leads");
      const startInput = new TextInputBuilder()
        .setCustomId("startDate")
        .setLabel("Start date (e.g. today or 2026-06-01)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const endInput = new TextInputBuilder()
        .setCustomId("endDate")
        .setLabel("End date (e.g. tomorrow or 2026-06-19)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(startInput),
        new ActionRowBuilder().addComponents(endInput)
      );
      return interaction.showModal(modal);
    }

    if (subcommand === "multi-add") {
      const source = interaction.options.getString("source");
      const modal = new ModalBuilder()
        // Source is injected into the customId so the handler receives it
        .setCustomId(`multiAddModal_${source}`)
        .setTitle("📋 Add Multiple Leads");
      const phonesInput = new TextInputBuilder()
        .setCustomId("phones")
        .setLabel("Phone numbers")
        .setPlaceholder("One per line, or separated by commas")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true);
      const notesInput = new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Note for all of them (optional)")
        .setPlaceholder("e.g. Event waiting list")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(phonesInput),
        new ActionRowBuilder().addComponents(notesInput)
      );
      return interaction.showModal(modal);
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      // 1. Permission check
      const employeeResponse = await axios.get(
        `${process.env.API_URL}/employees/external/${interaction.user.id}`
      );
      const currentEmployee = employeeResponse.data;
      const allowedRoles = ["Admin", "Manager", "Sales", "Support", "Marketing"];
      if (!allowedRoles.includes(currentEmployee.role?.name)) {
        return interaction.editReply(
          "❌ Unauthorized. Access restricted to Sales, Support, Marketing, and Management."
        );
      }

      // Delete/edit/sync are sensitive (they permanently change customer data) —
      // restricted to management, not the read/follow-up permission set.
      const MANAGEMENT_ONLY_SUBCOMMANDS = ["delete", "edit", "sync"];
      const isManager = ["Admin", "Manager"].includes(currentEmployee.role?.name);
      if (MANAGEMENT_ONLY_SUBCOMMANDS.includes(subcommand) && !isManager) {
        return interaction.editReply("❌ Only Management can delete, edit, or sync lead records.");
      }

      const response = await axios.get(`${process.env.API_URL}/crm/leads`);
      let leads = response.data;
      const statusMap = {
        NEW: "🆕 New",
        CONTACTED: "📞 Contacted",
        QUALIFIED: "⭐ Qualified",
        CONVERTED: "✅ Converted",
        LOST: "🚫 Not Interested",
      };
      const sourceMap = {
        WHATSAPP: "🟢 WhatsApp",
        WEBSITE: "🌐 Website",
        MANUAL: "✍️ Manual",
        PHONE: "📞 Phone Call",
        WALK_IN: "🚶 Walk-in",
        SOCIAL: "📱 Social Media",
        IMPORT: "📥 Imported",
      };

      // ========================== List ==========================
      if (subcommand === "list") {
        const searchQuery = interaction.options.getString("search");
        if (searchQuery) {
          leads = leads.filter(
            (lead) =>
              (lead.name && lead.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
              (lead.phone && lead.phone.includes(searchQuery))
          );
        }
        if (!leads.length) {
          return interaction.editReply(
            searchQuery
              ? `📭 No leads found matching: **${searchQuery}**`
              : "📭 No leads found yet."
          );
        }
        const limit = interaction.options.getInteger("limit") || 10;
        const topLeads = leads.slice(0, limit);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO || 0x0099ff)
          .setTitle("📊 CRM Leads Overview")
          .setFooter({ text: `Search: ${searchQuery || "All Leads"} | Total: ${leads.length}` })
          .setTimestamp();
        embed.setDescription(
          topLeads
            .map((lead) => {
              const msg =
                lead.interactions?.find((i) => i.origin === "CUSTOMER")?.content ||
                "No interactions";
              const shortMsg = msg.length > 45 ? msg.substring(0, 45) + "..." : msg;
              return `**${lead.name || "Unknown"}** → *${shortMsg}*`;
            })
            .join("\n") || "No recent interactions."
        );
        topLeads.forEach((lead) => {
          embed.addFields({
            name: `\u200E👤 ${lead.name || "Unknown"}`,
            value: `\u200E📱 ${formatPhone(lead.phone)}\n\u200E${statusMap[lead.status] || `🚦 ${lead.status}`}\n\u200E${sourceMap[lead.source] || `🔗 ${lead.source}`}`,
            inline: true,
          });
        });
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Info ==========================
      else if (subcommand === "info") {
        const query = interaction.options.getString("query");
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle(`📇 Lead Profile: ${lead.name || "Unknown"}`)
          .addFields(
            { name: "📱 Phone", value: formatPhone(lead.phone), inline: true },
            { name: "🚦 Status", value: statusMap[lead.status] || lead.status, inline: true },
            { name: "🎯 Score", value: `${lead.score} pts`, inline: true },
            { name: "🔗 Source", value: sourceMap[lead.source] || lead.source, inline: true },
            {
              name: "👤 Assigned To",
              value: lead.assignedTo?.name || "Not Assigned",
              inline: true,
            },
            {
              name: "📅 Created At",
              value: `<t:${Math.floor(new Date(lead.createdAt).getTime() / 1000)}:D>`,
              inline: true,
            }
          )
          .setTimestamp();
        if (lead.notes) embed.addFields({ name: "📝 Notes", value: lead.notes, inline: false });
        if (lead.interactions && lead.interactions.length > 0) {
          const interactionsText = lead.interactions
            .slice(0, 10)
            .map((i) => {
              const arrow =
                i.origin === "CUSTOMER" ? "⬅️" : i.origin === "AUTOMATION" ? "🤖" : "➡️";
              const text = i.content || "";
              const shortContent = text.length > 80 ? text.substring(0, 80) + "..." : text;
              return `${arrow} [<t:${Math.floor(new Date(i.createdAt).getTime() / 1000)}:t>] ${shortContent}`;
            })
            .join("\n\n");
          const finalValue =
            interactionsText.length > 1024
              ? interactionsText.substring(0, 1020) + "..."
              : interactionsText;
          embed.addFields({
            name: "💬 Recent Interactions (Last 10)",
            value: finalValue,
            inline: false,
          });
        } else {
          embed.addFields({
            name: "💬 Interactions",
            value: "No interactions yet.",
            inline: false,
          });
        }
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Assign ==========================
      else if (subcommand === "assign") {
        const query = interaction.options.getString("query");
        const employeeId = interaction.options.getString("employee");
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        const updateResponse = await axios.patch(
          `${process.env.API_URL}/crm/leads/${lead.id}/assign`,
          { employeeId }
        );
        clearCache("leads_list");
        const updatedLead = updateResponse.data;
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle("✅ Lead Assigned Successfully")
          .setDescription(
            `**${updatedLead.name || "Lead"}** has been assigned to **${updatedLead.assignedTo?.name || "the employee"}**.`
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Status ==========================
      else if (subcommand === "status") {
        const query = interaction.options.getString("query");
        const newStatus = interaction.options.getString("new_status");
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        const oldStatus = lead.status;
        const updateResponse = await axios.patch(
          `${process.env.API_URL}/crm/leads/${lead.id}/status`,
          { status: newStatus }
        );
        clearCache("leads_list");
        const updatedLead = updateResponse.data;
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle("🚦 Pipeline Update")
          .setDescription(`\u200E👤 **Lead:** ${updatedLead.name}`)
          .addFields(
            { name: "⬅️ Old Status", value: `${statusMap[oldStatus] || oldStatus}`, inline: true },
            {
              name: "➡️ New Status",
              value: `${statusMap[updatedLead.status] || updatedLead.status}`,
              inline: true,
            }
          )
          .setFooter({ text: `Updated by ${interaction.user.username}` })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Stats ==========================
      else if (subcommand === "stats") {
        const statsResponse = await axios.get(`${process.env.API_URL}/crm/leads/stats`);
        const stats = statsResponse.data;
        const conversionRate =
          stats.total > 0 ? ((stats.byStatus.CONVERTED / stats.total) * 100).toFixed(1) : 0;
        const embed = new EmbedBuilder()
          .setColor(0x8e44ad)
          .setTitle("📊 CRM Performance Overview")
          .setDescription(`📈 **Total Leads:** ${stats.total} | **Conversion:** ${conversionRate}%`)
          .addFields(
            { name: "🆕 New", value: `**${stats.byStatus.NEW}**`, inline: true },
            { name: "📞 Contacted", value: `**${stats.byStatus.CONTACTED}**`, inline: true },
            { name: "⭐ Qualified", value: `**${stats.byStatus.QUALIFIED}**`, inline: true },
            { name: "✅ Converted", value: `**${stats.byStatus.CONVERTED}**`, inline: true },
            { name: "🚫 Not Interested", value: `**${stats.byStatus.LOST}**`, inline: true }
          )
          .setFooter({ text: "CRM Performance Analytics" })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Sync ==========================
      else if (subcommand === "sync") {
        const response = await axios.post(`${process.env.API_URL}/crm/leads/sync`);
        const { total, tabs, rows, clearedTabs } = response.data;
        clearCache("leads_list");
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle("🔄 Google Sheet Rebuilt")
          .setDescription("The sheet now matches the database exactly.")
          .addFields(
            { name: "👥 Leads in database", value: `${total}`, inline: true },
            { name: "📄 Tabs written", value: `${tabs}`, inline: true },
            { name: "📝 Rows written", value: `${rows}`, inline: true }
          )
          .setFooter({ text: `Rebuilt by ${interaction.user.username}` })
          .setTimestamp();
        if (clearedTabs > 0) {
          embed.addFields({
            name: "🧹 Emptied tabs",
            value: `${clearedTabs} tab(s) had no matching leads`,
            inline: false,
          });
        }
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Add ==========================
      else if (subcommand === "add") {
        const phone = interaction.options.getString("phone");
        const name = interaction.options.getString("name");
        const source = interaction.options.getString("source") || "MANUAL";
        const notes = interaction.options.getString("notes");
        try {
          const { data: lead } = await axios.post(`${process.env.API_URL}/crm/leads`, {
            phone,
            name,
            source,
            notes,
            addedByName: currentEmployee.name,
          });
          clearCache("leads_list");
          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
            .setTitle("➕ Lead Added")
            .addFields(
              { name: "👤 Name", value: lead.name, inline: true },
              { name: "📱 Phone", value: formatPhone(lead.phone), inline: true },
              { name: "🔗 Source", value: sourceMap[lead.source] || lead.source, inline: true }
            )
            .setFooter({ text: `Added by ${currentEmployee.name}` })
            .setTimestamp();
          if (lead.notes) embed.addFields({ name: "📝 Notes", value: lead.notes, inline: false });
          return interaction.editReply({ embeds: [embed] });
        } catch (error) {
          // Number already exists — show the existing record instead of duplicating
          if (error.response?.status === 409) {
            const existing = error.response.data.lead;
            const embed = new EmbedBuilder()
              .setColor(EMBED_COLORS.WARNING || 0xffa500)
              .setTitle("⚠️ Lead Already Exists")
              .setDescription("This phone number is already in the CRM.")
              .addFields(
                { name: "👤 Name", value: existing.name || "Unknown", inline: true },
                { name: "📱 Phone", value: formatPhone(existing.phone), inline: true },
                {
                  name: "🚦 Status",
                  value: statusMap[existing.status] || existing.status,
                  inline: true,
                },
                {
                  name: "👥 Assigned To",
                  value: existing.assignedTo?.name || "Not Assigned",
                  inline: true,
                },
                {
                  name: "📅 Created",
                  value: `<t:${Math.floor(new Date(existing.createdAt).getTime() / 1000)}:D>`,
                  inline: true,
                }
              )
              .setFooter({ text: "Use /lead info to see the full profile" })
              .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
          }
          if (error.response?.status === 400) {
            return interaction.editReply(
              "❌ Invalid phone number. Use a local number (55512345) or an international one (+15551234567)."
            );
          }
          throw error;
        }
      }
      // ========================== Note ==========================
      else if (subcommand === "note") {
        const query = interaction.options.getString("query");
        const content = interaction.options.getString("content");
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        const updateResponse = await axios.patch(
          `${process.env.API_URL}/crm/leads/${lead.id}/note`,
          { note: content }
        );
        clearCache("leads_list");
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.SUCCESS || 0x00ff00)
          .setTitle("📝 Note Added")
          .setDescription(`Note added to **${updateResponse.data.name}**:\n\n> ${content}`)
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Delete ==========================
      else if (subcommand === "delete") {
        const query = interaction.options.getString("query");
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        await axios.delete(`${process.env.API_URL}/crm/leads/${lead.id}`);
        clearCache("leads_list");
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("🗑️ Lead Deleted Successfully")
          .setDescription(
            `**${lead.name || "Unknown"}** (${lead.phone || "No Phone"}) has been completely removed from the CRM and Google Sheets.`
          )
          .setFooter({ text: `Deleted by ${interaction.user.username}` })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      // ========================== Edit ==========================
      else if (subcommand === "edit") {
        const query = interaction.options.getString("query");
        const newName = interaction.options.getString("new_name");
        const newPhone = interaction.options.getString("new_phone");
        if (!newName && !newPhone) {
          return interaction.editReply(
            "❌ You must provide at least a `new_name` or `new_phone` to edit."
          );
        }
        const lead = leads.find(
          (l) =>
            l.id === query ||
            (l.phone && l.phone.includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query.toLowerCase()))
        );
        if (!lead) return interaction.editReply(`❌ No lead found matching **${query}**.`);
        const updatePayload = {};
        if (newName) updatePayload.name = newName;
        if (newPhone) updatePayload.phone = newPhone;
        const updateResponse = await axios.patch(
          `${process.env.API_URL}/crm/leads/${lead.id}/edit`,
          updatePayload
        );
        clearCache("leads_list");
        const updatedLead = updateResponse.data;
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("✏️ Lead Updated Successfully")
          .setDescription(`Lead details have been updated and synced to Google Sheets.`)
          .addFields(
            { name: "👤 Name", value: updatedLead.name || "Unknown", inline: true },
            { name: "📱 Phone", value: updatedLead.phone || "N/A", inline: true }
          )
          .setFooter({ text: "Updated by " + interaction.user.username })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        "❌ Failed to process the request. Please ensure the API is running."
      );
    }
  },

  async autocomplete(interaction) {
    const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
    await handleGlobalAutocomplete(interaction);
  },

  async handleFilterModal(interaction) {
    const startInput = interaction.fields.getTextInputValue("startDate");
    const endInput = interaction.fields.getTextInputValue("endDate");
    const { parseDate } = require("../utils/dateParser");
    const startDate = parseDate(startInput);
    const endDate = parseDate(endInput);
    if (!startDate || !endDate) {
      return interaction.reply({
        content: "❌ Invalid date. Use YYYY-MM-DD, or words like today / tomorrow.",
        ephemeral: true,
      });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const response = await axios.get(`${process.env.API_URL}/crm/leads/filter`, {
        params: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      });
      const leads = response.data;
      if (!leads.length)
        return interaction.editReply(
          `📭 No leads found between **${startInput}** and **${endInput}**.`
        );
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.INFO || 0x3498db)
        .setTitle(`📅 Leads Filter: ${startInput} to ${endInput}`)
        .setDescription(
          leads
            .map(
              (l) =>
                `👤 **${l.name || "Unknown"}** - <t:${Math.floor(new Date(l.createdAt).getTime() / 1000)}:d>`
            )
            .join("\n")
        )
        .setFooter({ text: `Total found: ${leads.length}` });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("Filter Error:", err.message);
      return interaction.editReply("❌ Failed to fetch leads. Please try again.");
    }
  },

  async handleMultiAddModal(interaction) {
    const source = interaction.customId.replace("multiAddModal_", "") || "MANUAL";
    const phones = interaction.fields.getTextInputValue("phones");
    const notes = interaction.fields.getTextInputValue("notes") || null;
    await interaction.deferReply({ ephemeral: true });
    try {
      const employeeResponse = await axios.get(
        `${process.env.API_URL}/employees/external/${interaction.user.id}`
      );
      const currentEmployee = employeeResponse.data;
      const allowedRoles = ["Admin", "Manager", "Sales", "Marketing"];
      if (!allowedRoles.includes(currentEmployee.role?.name)) {
        return interaction.editReply("❌ Unauthorized to add leads in bulk.");
      }
      const { data } = await axios.post(`${process.env.API_URL}/crm/leads/bulk`, {
        input: phones,
        source,
        notes,
        addedByName: currentEmployee.name,
      });
      clearCache("leads_list");
      const embed = new EmbedBuilder()
        .setColor(
          data.addedCount > 0 ? EMBED_COLORS.SUCCESS || 0x00ff00 : EMBED_COLORS.WARNING || 0xffa500
        )
        .setTitle("📋 Bulk Add Complete")
        .setDescription(`Processed **${data.submitted}** entries.`)
        .addFields(
          { name: "✅ Added", value: `**${data.addedCount}**`, inline: true },
          { name: "🔁 Already existed", value: `**${data.duplicateCount}**`, inline: true },
          { name: "❌ Invalid", value: `**${data.invalidCount}**`, inline: true }
        )
        .setFooter({ text: `Added by ${currentEmployee.name}` })
        .setTimestamp();
      if (data.invalid.length) {
        embed.addFields({
          name: "❌ These could not be read",
          value: `\`\`\`\n${data.invalid.slice(0, 20).join("\n").slice(0, 1000)}\n\`\`\``,
          inline: false,
        });
      }
      if (data.duplicates.length) {
        embed.addFields({
          name: "🔁 Skipped (already in the CRM)",
          value: data.duplicates
            .slice(0, 10)
            .map((d) => `\`${d.phone}\``)
            .join(" · ")
            .slice(0, 1000),
          inline: false,
        });
      }
      if (data.addedCount > 0) {
        embed.addFields({
          name: "📤 Next step",
          value:
            "They are all in the CRM now with the name `Customer ####`.\n" +
            "To message them: `/campaign new` → **added_within: 1**",
          inline: false,
        });
      }
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[Bulk Add Error]:", error.message);
      const message = error.response?.data?.error || "Failed to add the leads. Please try again.";
      return interaction.editReply(`❌ ${message}`);
    }
  },
};
