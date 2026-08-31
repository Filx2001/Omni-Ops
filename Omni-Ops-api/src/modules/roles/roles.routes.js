const express = require("express");
const router = express.Router();
const svc = require("./roles.service");

router.post("/", async (req, res) => {
  try {
    const role = await svc.createRole(req.workspace.id, req.body);
    res.status(201).json(role);
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ error: "A role with this name already exists in this workspace." });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    res.json(await svc.getRoles(req.workspace.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
