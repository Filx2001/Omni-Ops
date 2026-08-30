const express = require("express");
const router = express.Router();
const {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
  createClass,
  getClasses,
  deleteClass,
  updateClass,
  syncCalendarAccess,
  createClassesBulk,
  createEventsBulk, // 👈 دي اللي كانت ناقصة وعملت الايرور
  backfillAccounting,
} = require("./calendar.service");

// ========================== Events Routes ==========================
router.post("/events", async (req, res) => {
  try {
    const event = await createEvent(req.body);
    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/events/bulk", async (req, res) => {
  try {
    const result = await createEventsBulk(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/events", async (req, res) => {
  try {
    const events = await getEvents();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/events/:id", async (req, res) => {
  try {
    const event = await updateEvent(req.params.id, req.body, req.query.scope);
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/events/:id", async (req, res) => {
  try {
    const event = await deleteEvent(req.params.id, req.query.scope);
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================== Classes Routes ==========================
router.post("/classes", async (req, res) => {
  try {
    const schoolClass = await createClass(req.body);
    res.status(201).json(schoolClass);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/classes", async (req, res) => {
  try {
    const classes = await getClasses();
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/classes/:id", async (req, res) => {
  try {
    const schoolClass = await updateClass(req.params.id, req.body);
    res.json(schoolClass);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/classes/:id", async (req, res) => {
  try {
    const schoolClass = await deleteClass(req.params.id);
    res.json(schoolClass);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================== Sync & Bulk Routes ==========================
router.post("/classes/bulk", async (req, res) => {
  try {
    const result = await createClassesBulk(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/sync", async (req, res) => {
  try {
    const result = await syncCalendarAccess();
    res.json({ synced: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/accounting/backfill", async (req, res) => {
  try {
    const result = await backfillAccounting();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
