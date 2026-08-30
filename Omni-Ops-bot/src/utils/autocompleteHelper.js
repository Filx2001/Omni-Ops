const { getCachedData } = require("./cache");
const axios = require("./axiosInstance");

async function handleGlobalAutocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  try {
    // ================== 1. Employee / staff search ==================
    if (["employee", "assignee", "teacher"].includes(focusedOption.name)) {
      const employees = await getCachedData("employees_list", "/employees");
      const filtered = employees
        .filter((emp) => emp.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 10);
      return interaction.respond(
        filtered.map((emp) => ({
          name: `${emp.name} (${emp.role?.name || "No Role"})`,
          value: emp.id,
        }))
      );
    }

    // ================== 2. Roles ==================
    if (focusedOption.name === "role") {
      const roles = await getCachedData("roles_list", "/roles");
      const filtered = roles
        .filter((role) => role.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 10);
      return interaction.respond(filtered.map((role) => ({ name: role.name, value: role.id })));
    }

    // ================== 3. Tasks ==================
    if (focusedOption.name === "task") {
      const subcommand = interaction.options.getSubcommand();
      let tasks = [];
      try {
        const employeeResponse = await axios.get(
          `${process.env.API_URL}/employees/external/${interaction.user.id}`
        );
        const currentEmployee = employeeResponse.data;
        const isManager = ["Admin", "Manager"].includes(currentEmployee.role?.name);
        if (isManager || ["delete", "history"].includes(subcommand)) {
          tasks = await getCachedData("all_tasks", "/tasks");
        } else {
          const tasksResponse = await axios.get(
            `${process.env.API_URL}/tasks/employee/${currentEmployee.id}`
          );
          tasks = tasksResponse.data;
        }
      } catch (err) {
        console.error("[Autocomplete Task Error]:", err.message);
        tasks = [];
      }
      const filtered = tasks
        .filter((task) => task.title.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 10);
      return interaction.respond(filtered.map((task) => ({ name: task.title, value: task.id })));
    }

    // ================== 4. Appointments (legacy: class) ==================
    if (["appointment", "class"].includes(focusedOption.name)) {
      const appointments = await getCachedData("appointments_list", "/calendar/appointments");
      // Count series members so we can show it in the label
      const groupCounts = {};
      for (const a of appointments) {
        if (a.groupId) groupCounts[a.groupId] = (groupCounts[a.groupId] || 0) + 1;
      }
      const filtered = appointments
        .filter((a) =>
          (a.title || a.subject || "").toLowerCase().includes(focusedOption.value.toLowerCase())
        )
        .slice(0, 10);
      return interaction.respond(
        filtered.map((a) => {
          const dateStr = new Date(a.startTime).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
          });
          const label = a.title || a.subject || "Appointment";
          const seriesTag = a.groupId ? ` 🔁 series of ${groupCounts[a.groupId]}` : "";
          return {
            name: `${label} - ${a.day || ""} ${dateStr}${seriesTag}`.substring(0, 100),
            value: a.id,
          };
        })
      );
    }

    // ================== 5. Events ==================
    if (focusedOption.name === "event") {
      const events = await getCachedData("events_list", "/calendar/events");
      const groupCounts = {};
      for (const e of events) {
        if (e.groupId) groupCounts[e.groupId] = (groupCounts[e.groupId] || 0) + 1;
      }
      const filtered = events
        .filter((e) => e.title.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 10);
      return interaction.respond(
        filtered.map((e) => {
          const dateStr = new Date(e.startDate).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
          });
          const seriesTag = e.groupId ? ` 🔁 series of ${groupCounts[e.groupId]}` : "";
          return { name: `${e.title} - ${dateStr}${seriesTag}`.substring(0, 100), value: e.id };
        })
      );
    }

    // ================== 6. CRM leads ==================
    if (focusedOption.name === "query" || focusedOption.name === "lead") {
      const leads = await getCachedData("leads_list", "/crm/leads");
      const focusedValue = focusedOption.value.toLowerCase();
      const filtered = leads
        .filter(
          (lead) =>
            (lead.name && lead.name.toLowerCase().includes(focusedValue)) ||
            (lead.phone && lead.phone.includes(focusedValue))
        )
        .slice(0, 10);
      return interaction.respond(
        filtered.map((lead) => ({
          name: `👤 ${lead.name || "Unknown"} | 📱 ${lead.phone || "N/A"}`,
          value: lead.id,
        }))
      );
    }

    // ================== 7. Invoices (legacy: bill_id) ==================
    if (["invoice_id", "bill_id"].includes(focusedOption.name)) {
      const response = await getCachedData("invoices_list", "/invoices");
      const invoices = response.invoices || response;
      if (!Array.isArray(invoices)) return interaction.respond([]);
      const focusedValue = focusedOption.value.toLowerCase();
      const filtered = invoices
        .filter((b) => {
          const ref = `INV-${b.invoiceNumber ?? b.referenceId}`.toLowerCase();
          const name = (b.customerName || b.name || "").toLowerCase();
          return ref.includes(focusedValue) || name.includes(focusedValue);
        })
        .slice(0, 25);
      return interaction.respond(
        filtered.map((b) => {
          const statusIcon = b.status === "PAID" ? "✅" : b.status === "CANCELLED" ? "❌" : "⏳";
          const ref = `INV-${b.invoiceNumber ?? b.referenceId}`;
          const name = b.customerName || b.name || "Unknown";
          return { name: `${ref} | ${name} (${b.netAmount}) ${statusIcon}`, value: b.id };
        })
      );
    }
  } catch (error) {
    console.error("[Global Autocomplete Error]:", error);
    if (!interaction.responded) return interaction.respond([]);
  }
}

module.exports = { handleGlobalAutocomplete };
