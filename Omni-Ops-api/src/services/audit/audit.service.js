const prisma = require("../../prisma");

async function logAction({
  workspaceId,
  actorId = null,
  actorType = "system",
  action,
  entityType,
  entityId,
  oldValue = null,
  newValue = null,
}) {
  return prisma.auditLog.create({
    data: {
      workspaceId,
      actorId,
      actorType,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
    },
  });
}

async function getTaskHistory(taskId) {
  return prisma.auditLog.findMany({
    where: {
      entityType: "task",
      entityId: taskId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

module.exports = {
  logAction,
  getTaskHistory,
};
