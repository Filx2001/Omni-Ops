const prisma = require("../../prisma");

const INCLUDE = { role: true };

async function createEmployee(workspaceId, data) {
  return prisma.employee.create({
    data: {
      workspaceId,
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      externalId: data.externalId ?? null,
      roleId: data.roleId ?? null,
    },
    include: INCLUDE,
  });
}

async function getEmployees(workspaceId) {
  return prisma.employee.findMany({
    where: { workspaceId },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

// Identity lookup. Scoped when the workspace is known (slash commands);
// falls back to the oldest match for DM flows before tenant resolution.
async function getEmployeeByExternal(externalId, workspaceId = null) {
  return prisma.employee.findFirst({
    where: workspaceId ? { workspaceId, externalId } : { externalId },
    include: INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

async function getEmployeeById(workspaceId, id) {
  return prisma.employee.findFirst({ where: { workspaceId, id }, include: INCLUDE });
}

async function linkEmployee(workspaceId, employeeId, externalId) {
  return prisma.employee.update({
    where: { id: employeeId, workspaceId },
    data: { externalId },
    include: INCLUDE,
  });
}

async function deactivateEmployee(workspaceId, employeeId) {
  return prisma.employee.update({
    where: { id: employeeId, workspaceId },
    data: { isActive: false },
    include: INCLUDE,
  });
}

async function updateReminderSettings(workspaceId, id, data) {
  return prisma.employee.update({
    where: { id, workspaceId },
    data: {
      reminderEnabled: data.reminderEnabled,
      reminderValue: data.reminderValue,
      reminderUnit: data.reminderUnit,
    },
    include: INCLUDE,
  });
}

async function updateEmployeeRole(workspaceId, employeeId, roleId) {
  return prisma.employee.update({
    where: { id: employeeId, workspaceId },
    data: { roleId },
    include: INCLUDE,
  });
}

const UPDATABLE = ["name", "email", "phone", "roleId", "dailyReportEnabled"];

async function updateEmployee(workspaceId, id, data) {
  const clean = {};
  for (const field of UPDATABLE) {
    if (data[field] !== undefined) clean[field] = data[field];
  }
  return prisma.employee.update({ where: { id, workspaceId }, data: clean, include: INCLUDE });
}

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeByExternal,
  getEmployeeById,
  linkEmployee,
  deactivateEmployee,
  updateReminderSettings,
  updateEmployeeRole,
  updateEmployee,
};
