const prisma = require("../../prisma");

async function getDashboardStats(workspaceId) {
  const where = { workspaceId };

  const [
    totalEmployees,
    totalTasks,
    pendingTasks,
    openTasks,
    completedTasks,
    overdueTasks,
    urgentTasks,
    highPriorityTasks,
  ] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: "pending" } }),
    prisma.task.count({ where: { ...where, status: { in: ["pending", "in_progress"] } } }),
    prisma.task.count({ where: { ...where, status: "done" } }),
    prisma.task.count({
      where: { ...where, dueDate: { lt: new Date() }, status: { not: "done" } },
    }),
    prisma.task.count({ where: { ...where, priority: "urgent", status: { not: "done" } } }),
    prisma.task.count({ where: { ...where, priority: "high", status: { not: "done" } } }),
  ]);

  return {
    totalEmployees,
    totalTasks,
    pendingTasks,
    openTasks,
    completedTasks,
    overdueTasks,
    urgentTasks,
    highPriorityTasks,
  };
}

module.exports = { getDashboardStats };
