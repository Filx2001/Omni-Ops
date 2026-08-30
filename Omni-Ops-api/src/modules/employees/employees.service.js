const prisma = require("../../prisma");
async function createEmployee(data) {
  return prisma.employee.create({
    data,
    include: {
      role: true,
    },
  });
}

async function getEmployees() {
  return prisma.employee.findMany({
    include: {
      role: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function getEmployeeByDiscordId(discordId) {
  return prisma.employee.findUnique({
    where: {
      discordId,
    },
    include: {
      role: true,
    },
  });
}

// 🌟 الدالة الجديدة اللي البوت بيحتاجها عشان يبعت الـ DM
async function getEmployeeById(id) {
  return prisma.employee.findUnique({
    where: { id },
    include: { role: true },
  });
}

async function deactivateEmployee(employeeId) {
  return prisma.employee.update({
    where: {
      id: employeeId,
    },
    data: {
      isActive: false,
    },
    include: {
      role: true,
    },
  });
}

async function linkEmployee(employeeId, discordId) {
  return prisma.employee.update({
    where: {
      id: employeeId,
    },
    data: {
      discordId,
    },
  });
}

async function updateReminderSettings(id, data) {
  return prisma.employee.update({
    where: { id },
    data: {
      reminderEnabled: data.reminderEnabled,
      reminderValue: data.reminderValue,
      reminderUnit: data.reminderUnit,
    },
  });
}

async function updateEmployeeRole(employeeId, roleId) {
  return prisma.employee.update({
    where: { id: employeeId },
    data: { roleId },
    include: { role: true },
  });
}

async function updateEmployee(id, data) {
  return prisma.employee.update({
    where: { id },
    data,
    include: {
      role: true,
    },
  });
}

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeByDiscordId,
  getEmployeeById,
  linkEmployee,
  deactivateEmployee,
  updateReminderSettings,
  updateEmployeeRole,
  updateEmployee,
};
