const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const axios = require("../utils/axiosInstance");
const EMBED_COLORS = require("../utils/embedColors");
const { clearCache } = require("../utils/cache");
const { requireRole } = require("../utils/requireRole");
const { handleGlobalAutocomplete } = require("../utils/autocompleteHelper");
const { parseDate } = require("../utils/dateParser");
const { buildPdfUrl } = require("../utils/pdfLink");

const BILLING_ROLES = ["Admin", "Manager", "Sales", "Finance"];

module.exports = {
  data: new SlashCommandBuilder()
    // =================================== invoice ===================================
    .setName("invoice")
    .setDescription("Manage client invoices and sales")
    // =================================== invoice create ===================================
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new client invoice")
        .addStringOption((option) =>
          option.setName("name").setDescription("Client / Customer Name").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("activity")
            .setDescription("Service Type")
            .setRequired(true)
            .addChoices(
              { name: "🏕️ Camp / Workshop", value: "Workshop" },
              { name: "📚 Course / Training", value: "Course" },
              { name: "💼 Consulting", value: "Consulting" },
              { name: "🛠️ Service / Product", value: "Service" }
            )
        )
        .addNumberOption((option) =>
          option.setName("amount").setDescription("Unit Price").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("Service details / Item description")
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option.setName("quantity").setDescription("Quantity (Default: 1)").setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("discount")
            .setDescription("Discount % (Default: 0%)")
            .setRequired(false)
            .addChoices(
              { name: "5%", value: 5 },
              { name: "10%", value: 10 },
              { name: "15%", value: 15 },
              { name: "20%", value: 20 }
            )
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Payment Status (Default: Pending)")
            .setRequired(false)
            .addChoices(
              { name: "⏳ Pending", value: "PENDING" },
              { name: "✅ Paid", value: "PAID" }
            )
        )
    )
    // =================================== invoice status ===================================
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Update invoice payment status")
        .addStringOption((option) =>
          option
            .setName("invoice_id")
            .setDescription("Invoice ID")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("New Status")
            .setRequired(true)
            .addChoices(
              { name: "⏳ Pending", value: "PENDING" },
              { name: "✅ Paid", value: "PAID" },
              { name: "❌ Cancelled", value: "CANCELLED" }
            )
        )
    )
    // =================================== invoice list ===================================
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("View available invoices with search and filter options")
        .addStringOption((opt) =>
          opt
            .setName("invoice_no")
            .setDescription("Search by invoice number (e.g., INV-11)")
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("month")
            .setDescription("Filter by a specific month (1-12)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(12)
        )
        .addIntegerOption((opt) =>
          opt.setName("year").setDescription("Filter by year (e.g., 2026)").setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("start_date")
            .setDescription("Start date (e.g., 25/06, 25/06/2026, or today)")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("end_date")
            .setDescription("End date (e.g., 30/06, 30/06/2026, or tomorrow)")
            .setRequired(false)
        )
    )
    // =================================== invoice delete ===================================
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("❌ Delete an invoice permanently")
        .addStringOption((option) =>
          option
            .setName("invoice_id")
            .setDescription("Invoice ID")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const manager = await requireRole(interaction, BILLING_ROLES);
    if (!manager) return;

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply();
    // =================================== invoice create ===================================
    try {
      if (subcommand === "create") {
        const clientName = interaction.options.getString("name");
        const activityType = interaction.options.getString("activity");
        const description = interaction.options.getString("description") || "";
        const amount = interaction.options.getNumber("amount");
        const quantity = interaction.options.getInteger("quantity") || 1;
        const discount = interaction.options.getInteger("discount") || 0;
        const statusInput = interaction.options.getString("status") || "PENDING";
        const issuedByName = interaction.member?.displayName || interaction.user.username;

        const response = await axios.post(`/invoices`, {
          customerName: clientName,
          category: activityType,
          description,
          amount,
          quantity,
          discount,
          createdById: manager.id,
          issuedByName,
          status: statusInput,
        });

        clearCache("invoices_list");
        const invoice = response.data;
        const createdAt = new Date(invoice.createdAt);

        const formattedDate = createdAt.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        const formattedTime = createdAt.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });

        const grossAmount = amount * quantity;
        let detailsBlock = "";
        if (description) detailsBlock += `Desc: ${description}\n`;
        detailsBlock += `Qty:  ${quantity}\n`;
        detailsBlock += `Gross: ${grossAmount.toLocaleString()}\n`;

        let discountLine = "";
        if (discount > 0) discountLine = `🔻 **Discount:** \`${discount}%\`\n`;

        const statusDisplayMap = {
          PENDING: "⏳ PENDING",
          PAID: "✅ PAID",
          CANCELLED: "❌ CANCELLED",
        };
        const displayStatus = statusDisplayMap[invoice.status] || "⏳ PENDING";

        const embed = new EmbedBuilder()
          .setColor("#2b6cb0")
          .setAuthor({
            name: "🏢 Omni-Ops",
            iconURL: interaction.client.user.displayAvatarURL(),
          })
          .setTitle("OFFICIAL INVOICE")
          .setDescription(
            `**Invoice No:** \`INV-${invoice.invoiceNumber}\`\n` +
              `**Issue Date:** \`${formattedDate} - ${formattedTime}\`\n\n` +
              `👤 **Client:** \`${clientName}\`\n` +
              `🎯 **Service:** \`${activityType}\`\n\n` +
              `\`\`\`\n` +
              detailsBlock +
              `\`\`\`\n` +
              discountLine +
              `💰 **Net Total:** **\`${invoice.netAmount.toLocaleString()}\`**\n\n` +
              `🚦 **Status:** \`${displayStatus}\`\n` +
              `💻 **Issued By:** <@${interaction.user.id}>`
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`send_email_${invoice.id}`)
            .setLabel("✉️ Send Email")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel("📄 Save as PDF")
            .setStyle(ButtonStyle.Link)
            .setURL(buildPdfUrl(invoice.id))
        );

        const replyMessage = await interaction.editReply({ embeds: [embed], components: [row] });

        const collector = replyMessage.createMessageComponentCollector({ time: 3600000 });
        collector.on("collect", async (i) => {
          if (i.customId === `send_email_${invoice.id}`) {
            const modal = new ModalBuilder()
              .setCustomId(`email_modal_${invoice.id}`)
              .setTitle("Send Invoice to Client");

            const emailInput = new TextInputBuilder()
              .setCustomId("client_email")
              .setLabel("Client Email Address")
              .setPlaceholder("example@gmail.com")
              .setStyle(TextInputStyle.Short)
              .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(emailInput));
            await i.showModal(modal);

            try {
              const modalSubmit = await i.awaitModalSubmit({
                filter: (mi) =>
                  mi.customId === `email_modal_${invoice.id}` && mi.user.id === i.user.id,
                time: 60000,
              });

              const clientEmail = modalSubmit.fields.getTextInputValue("client_email");
              await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

              await axios.post(`/invoices/${invoice.id}/send`, {
                email: clientEmail,
              });

              await modalSubmit.editReply(
                `✅ The invoice has been successfully sent to **${clientEmail}**!`
              );

              const emailRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId("sent_done")
                  .setLabel(`✉️ Sent to ${clientEmail}`)
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true)
              );

              const pdfRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel("📄 Save as PDF")
                  .setStyle(ButtonStyle.Link)
                  .setURL(buildPdfUrl(invoice.id))
              );

              await interaction.editReply({ components: [emailRow, pdfRow] });
            } catch (err) {
              console.error("Modal error or timeout:", err);
            }
          }
        });
      }
      // =================================== invoice status ===================================
      else if (subcommand === "status") {
        const invoiceId = interaction.options.getString("invoice_id");
        const status = interaction.options.getString("status");

        const invoicesResponse = await axios.get(`/invoices`);
        const invoicesList = invoicesResponse.data.invoices || invoicesResponse.data;
        const invoiceToUpdate = invoicesList.find((b) => b.id === invoiceId);
        const refDisplay = invoiceToUpdate
          ? `INV-${invoiceToUpdate.invoiceNumber}`
          : "The selected invoice";

        await axios.patch(`/invoices/${invoiceId}/status`, { status });
        clearCache("invoices_list");

        const embed = new EmbedBuilder()
          .setColor(status === "PAID" ? "#2ecc71" : status === "CANCELLED" ? "#e74c3c" : "#f1c40f")
          .setTitle("🔄 Invoice Status Updated")
          .setDescription(
            `The status of **${refDisplay}** has been updated to **${status}** successfully.`
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }
      // =================================== invoice delete ===================================
      else if (subcommand === "delete") {
        const invoiceId = interaction.options.getString("invoice_id");
        try {
          await axios.delete(`/invoices/${invoiceId}`);
          clearCache("invoices_list");
          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.DELETE || "#e74c3c")
            .setTitle("🗑️ Invoice Deleted")
            .setDescription(
              "The invoice has been permanently removed from the system and the accounting sheet."
            )
            .setTimestamp();
          return interaction.editReply({ embeds: [embed] });
        } catch (error) {
          if (error.response?.status === 404) {
            return interaction.editReply("❌ Invoice not found.");
          }
          throw error;
        }
      }
      // =================================== invoice list ===================================
      else if (subcommand === "list") {
        const invoiceNo = interaction.options.getString("invoice_no");
        const month = interaction.options.getInteger("month");
        const year = interaction.options.getInteger("year");
        let startDate = interaction.options.getString("start_date");
        let endDate = interaction.options.getString("end_date");

        if (startDate) {
          const parsedStart = parseDate(startDate);
          if (!parsedStart) {
            return interaction.editReply(
              "❌ Invalid start date format. Please use DD/MM, DD/MM/YYYY, or 'today'."
            );
          }
          startDate = `${parsedStart.getFullYear()}-${String(parsedStart.getMonth() + 1).padStart(2, "0")}-${String(parsedStart.getDate()).padStart(2, "0")}`;
        }

        if (endDate) {
          const parsedEnd = parseDate(endDate);
          if (!parsedEnd) {
            return interaction.editReply(
              "❌ Invalid end date format. Please use DD/MM, DD/MM/YYYY, or 'today'."
            );
          }
          endDate = `${parsedEnd.getFullYear()}-${String(parsedEnd.getMonth() + 1).padStart(2, "0")}-${String(parsedEnd.getDate()).padStart(2, "0")}`;
        }

        const params = new URLSearchParams();
        if (invoiceNo) params.append("invoiceNo", invoiceNo);
        if (month) params.append("month", month);
        if (year) params.append("year", year);
        if (startDate) params.append("startDate", startDate);
        if (endDate) params.append("endDate", endDate);

        try {
          const response = await axios.get(`/invoices?${params.toString()}`);
          const data = response.data;
          const invoices = data.invoices || data;
          const totalAmount = data.totalAmount || invoices.reduce((sum, b) => sum + b.netAmount, 0);

          if (!invoices || !invoices.length) {
            return interaction.editReply("📭 No invoices found matching your criteria.");
          }

          const statusMap = { PENDING: "⏳", PAID: "✅", CANCELLED: "❌" };

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.INFO)
            .setTitle("📊 Omni-Ops Invoices Report")
            .setDescription(
              `**Total net amount for current search:** \`${totalAmount.toLocaleString()}\` 💰\n\n` +
                invoices
                  .slice(0, 15)
                  .map((b) => {
                    const date = new Date(b.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    });
                    const statusEmoji = statusMap[b.status] || "⏳";
                    return `\`[${date}]\` **INV-${b.invoiceNumber}** | ${b.customerName} | **${b.netAmount.toLocaleString()}** ${statusEmoji} | [📄 View PDF](${buildPdfUrl(b.id)})`;
                  })
                  .join("\n\n")
            )
            .setTimestamp()
            .setFooter({ text: "Omni-Ops Financials" });

          if (invoices.length > 15) {
            embed.addFields({
              name: "Note",
              value: `Showing latest 15 out of ${invoices.length} invoices. Refine search parameters for more specific results.`,
            });
          }

          return interaction.editReply({ embeds: [embed] });
        } catch (error) {
          console.error("Fetch invoices error:", error);
          return interaction.editReply("❌ Something went wrong while fetching invoices.");
        }
      }
    } catch (globalError) {
      console.error("Command execution error:", globalError);
      return interaction.editReply("❌ An unexpected error occurred.");
    }
  },

  async autocomplete(interaction) {
    await handleGlobalAutocomplete(interaction);
  },
};
