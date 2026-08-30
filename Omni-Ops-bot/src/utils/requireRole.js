const axios = require("./axiosInstance");
const EMBED_COLORS = require("./embedColors");
const { EmbedBuilder } = require("discord.js");

const MANAGEMENT_ROLES = ["Admin", "Manager"];

async function resolveEmployee(user) {
  try {
    const res = await axios.get(`/employees/external/${user.id}`);
    return res.data;
  } catch {
    return null;
  }
}

// Zero-config: the server owner gets an Admin employee profile automatically
async function autoProvisionOwner(guild, user) {
  try {
    const roles = (await axios.get("/roles")).data;
    const adminRole = roles.find((r) => r.name === "Admin");
    const res = await axios.post("/employees", {
      name: user.username,
      email: `${user.id}@users.omni-ops.local`, // placeholder, owner can edit later
      phone: null,
      roleId: adminRole?.id || null,
      externalId: user.id,
    });
    return res.data;
  } catch {
    return null;
  }
}

async function requireRole(interaction, roles = MANAGEMENT_ROLES) {
  const isOwner = interaction.user.id === interaction.guild.ownerId; // live check — transfers automatically
  let employee = await resolveEmployee(interaction.user);

  if (!employee && isOwner) {
    employee = await autoProvisionOwner(interaction.guild, interaction.user);
  }

  if (isOwner) return employee; // owner bypasses everything

  if (!employee || !roles.includes(employee.role?.name)) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.DELETE)
      .setTitle("❌ Permission Denied")
      .setDescription("You don't have permission to use this command.");
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [embed] });
      else await interaction.reply({ embeds: [embed], flags: 64 });
    } catch {}
    return null;
  }
  return employee;
}

module.exports = { requireRole, MANAGEMENT_ROLES };
