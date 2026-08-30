const express = require("express");
const router = express.Router();

const {
  createTask,
  getTasks,
  updateTask,
  updateTaskStatus,
  getTasksByEmployee,
  getTaskAuditHistory,
  deleteTask,
} = require("./tasks.service");

router.post("/", async (req, res) => {
  try {
    const task = await createTask(req.body);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/employee/:employeeId", async (req, res) => {
  try {
    const tasks = await getTasksByEmployee(req.params.employeeId);

    res.json(tasks);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/:id/history", async (req, res) => {
  try {
    const history = await getTaskAuditHistory(req.params.id);

    res.json(history);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/employee/:employeeId/performance", async (req, res) => {
  try {
    const tasks = await getTasksByEmployee(req.params.employeeId);

    res.json(tasks);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const tasks = await getTasks();

    res.json(tasks);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const task = await updateTaskStatus(req.params.id, req.body.status);

    res.json(task);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const task = await updateTask(req.params.id, req.body);

    res.json(task);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const task = await deleteTask(req.params.id);

    res.json(task);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

module.exports = router;
