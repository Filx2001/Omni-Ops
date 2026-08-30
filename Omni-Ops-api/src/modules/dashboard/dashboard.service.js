const prisma = require("../../prisma");
async function getDashboardStats() {
  const totalEmployees = await prisma.employee.count();

  const totalTasks = await prisma.task.count();

  const pendingTasks = await prisma.task.count({
    where: {
      status: "pending",
    },
  });

  const openTasks = await prisma.task.count({
    where: {
      status: {
        in: ["pending", "in_progress"],
      },
    },
  });

  const completedTasks = await prisma.task.count({
    where: {
      status: "done",
    },
  });

  const overdueTasks = await prisma.task.count({
    where: {
      dueDate: {
        lt: new Date(),
      },
      status: {
        not: "done",
      },
    },
  });

  const urgentTasks = await prisma.task.count({
    where: {
      priority: "urgent",
      status: {
        not: "done",
      },
    },
  });

  const highPriorityTasks = await prisma.task.count({
    where: {
      priority: "high",
      status: {
        not: "done",
      },
    },
  });

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

module.exports = {
  getDashboardStats,
};
