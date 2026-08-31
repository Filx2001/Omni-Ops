const express = require("express");
const router = express.Router();
const svc = require("./employees.service");

// POST /employees — create an employee in the current workspace
router.post("/", async (req, res) => {
  try {
    const employee = await svc.createEmployee(req.workspace.id, req.body);
    res.status(201).json(employee);
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ error: "Email or platform ID already exists in this workspace." });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET /employees/external/:externalId — identity lookup (workspace header optional)
router.get("/external/:externalId", async (req, res) => {
  try {
    const employee = await svc.getEmployeeByExternal(
      req.params.externalId,
      req.workspace?.id || null
    );
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /employees — list employees of the current workspace
router.get("/", async (req, res) => {
  try {
    res.json(await svc.getEmployees(req.workspace.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /employees/:id — single employee (must stay AFTER /external)
router.get("/:id", async (req, res) => {
  try {
    const employee = await svc.getEmployeeById(req.workspace.id, req.params.id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /employees/:id/link — link a platform account (Discord/Slack)
router.patch("/:id/link", async (req, res) => {
  try {
    const employee = await svc.linkEmployee(req.workspace.id, req.params.id, req.body.externalId);
    res.json(employee);
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ error: "Employee not found" });
    if (error.code === "P2002")
      return res
        .status(409)
        .json({ error: "That platform account is already linked to another employee." });
    res.status(500).json({ error: error.message });
  }
});

// PATCH /employees/:id/deactivate
router.patch("/:id/deactivate", async (req, res) => {
  try {
    res.json(await svc.deactivateEmployee(req.workspace.id, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /employees/:id/reminder — personal reminder preferences
router.patch("/:id/reminder", async (req, res) => {
  try {
    res.json(await svc.updateReminderSettings(req.workspace.id, req.params.id, req.body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /employees/:id/role — promote / change role
router.patch("/:id/role", async (req, res) => {
  try {
    res.json(await svc.updateEmployeeRole(req.workspace.id, req.params.id, req.body.roleId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /employees/:id — general update (name, email, phone, role, dailyReport)
router.patch("/:id", async (req, res) => {
  try {
    res.json(await svc.updateEmployee(req.workspace.id, req.params.id, req.body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
