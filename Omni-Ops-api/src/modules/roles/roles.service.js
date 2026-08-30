const prisma = require("../../prisma");

async function createRole(data) {
  return prisma.role.create({
    data,
  });
}

async function getRoles() {
  return prisma.role.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
}

module.exports = {
  createRole,
  getRoles,
};
