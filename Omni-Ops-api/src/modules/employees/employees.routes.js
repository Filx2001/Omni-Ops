const express = require("express");
const router = express.Router();
const {
  createEmployee,
  getEmployees,
  getEmployeeByDiscordId,
  getEmployeeById, // ⬅️ جديد: لازم تضيف الدالة دي في employees.service.js (تحت)
  linkEmployee,
  deactivateEmployee,
  updateReminderSettings,
  updateEmployeeRole,
  updateEmployee,
} = require("./employees.service");

router.post("/", async (req, res) => {
  try {
    const employee = await createEmployee(req.body);

    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/discord/:discordId", async (req, res) => {
  try {
    const employee = await getEmployeeByDiscordId(req.params.discordId);

    if (!employee) {
      return res.status(404).json({
        error: "Employee not found",
      });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const employees = await getEmployees();

    res.json(employees);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// ⬅️ جديد: جلب موظف واحد بالـ id (ده اللي البوت بيحتاجه عشان يجيب الـ discordId ويبعت الـ DM)
// مهم: لازم يفضل بعد /discord/:discordId عشان ما يخطفش الراوت بتاعه.
router.get("/:id", async (req, res) => {
  try {
    const employee = await getEmployeeById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        error: "Employee not found",
      });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id/link", async (req, res) => {
  try {
    const employee = await linkEmployee(req.params.id, req.body.discordId);

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id/deactivate", async (req, res) => {
  try {
    const employee = await deactivateEmployee(req.params.id);

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});
router.patch("/:id/reminder", async (req, res) => {
  try {
    const employee = await updateReminderSettings(req.params.id, req.body);

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id/role", async (req, res) => {
  try {
    const employee = await updateEmployeeRole(req.params.id, req.body.roleId);
    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const employee = await updateEmployee(req.params.id, req.body);

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});
module.exports = router;
