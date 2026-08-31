const express = require("express");
const router = express.Router();
const svc = require("./tasks.service");

router.post("/", async (req, res) => {
  try {
    const task = await svc.createTask(req.workspace, req.body);
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/employee/:employeeId", async (req, res) => {
  try {
    res.json(await svc.getTasksByEmployee(req.workspace, req.params.employeeId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/history", async (req, res) => {
  try {
    res.json(await svc.getTaskAuditHistory(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/employee/:employeeId/performance", async (req, res) => {
  try {
    res.json(await svc.getTasksByEmployee(req.workspace, req.params.employeeId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    res.json(await svc.getTasks(req.workspace));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    res.json(await svc.updateTaskStatus(req.workspace, req.params.id, req.body.status));
  } catch (error) {
    if (error.message === "Task not found.") return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    res.json(await svc.updateTask(req.workspace, req.params.id, req.body));
  } catch (error) {
    if (error.message === "Task not found.") return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    res.json(await svc.deleteTask(req.workspace, req.params.id));
  } catch (error) {
    if (error.message === "Task not found.") return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
