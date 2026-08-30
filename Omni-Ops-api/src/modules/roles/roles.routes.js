const express = require("express");
const router = express.Router();

const { createRole, getRoles } = require("./roles.service");

router.post("/", async (req, res) => {
  try {
    const role = await createRole(req.body);

    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const roles = await getRoles();

    res.json(roles);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

module.exports = router;
