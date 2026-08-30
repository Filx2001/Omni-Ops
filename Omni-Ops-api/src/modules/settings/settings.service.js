const prisma = require("../../prisma");

async function getGuildSettings(guildId) {
  return prisma.guildSettings.findUnique({
    where: { guildId },
  });
}

async function updateGuildSettings(guildId, data) {
  return prisma.guildSettings.upsert({
    where: { guildId },
    update: data,
    create: {
      guildId,
      ...data,
    },
  });
}

module.exports = {
  getGuildSettings,
  updateGuildSettings,
};
