const prisma = require("../../prisma");

async function createRole(workspaceId, data) {
  return prisma.role.create({
    data: {
      workspaceId,
      name: data.name,
      description: data.description ?? null,
    },
  });
}

async function getRoles(workspaceId) {
  return prisma.role.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
}

module.exports = { createRole, getRoles };
