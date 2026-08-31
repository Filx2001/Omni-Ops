const express = require("express");
const router = express.Router();
const svc = require("./calendar.service");

// ══════════════════════════ EVENTS ══════════════════════════

router.post("/events", async (req, res) => {
  try {
    const event = await svc.createEvent(req.workspace, req.body);
    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/events/bulk", async (req, res) => {
  try {
    const result = await svc.createEventsBulk(req.workspace, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/events", async (req, res) => {
  try {
    res.json(await svc.getEvents(req.workspace));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/events/:id", async (req, res) => {
  try {
    res.json(await svc.updateEvent(req.workspace, req.params.id, req.body, req.query.scope));
  } catch (error) {
    if (error.message === "Event not found") return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.delete("/events/:id", async (req, res) => {
  try {
    res.json(await svc.deleteEvent(req.workspace, req.params.id, req.query.scope));
  } catch (error) {
    if (error.message === "Event not found") return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════ APPOINTMENTS ══════════════════════════

router.post("/appointments", async (req, res) => {
  try {
    const appointment = await svc.createAppointment(req.workspace, req.body);
    res.status(201).json(appointment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/appointments", async (req, res) => {
  try {
    res.json(await svc.getAppointments(req.workspace));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/appointments/:id", async (req, res) => {
  try {
    res.json(await svc.updateAppointment(req.workspace, req.params.id, req.body));
  } catch (error) {
    if (error.message === "Appointment not found")
      return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.delete("/appointments/:id", async (req, res) => {
  try {
    res.json(await svc.deleteAppointment(req.workspace, req.params.id));
  } catch (error) {
    if (error.message === "Appointment not found")
      return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post("/appointments/bulk", async (req, res) => {
  try {
    const result = await svc.createAppointmentsBulk(req.workspace, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════ SYNC & BACKFILL ══════════════════════════

router.post("/sync", async (req, res) => {
  try {
    const result = await svc.syncCalendarAccess(req.workspace);
    res.json({ synced: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/accounting/backfill", async (req, res) => {
  try {
    res.json(await svc.backfillAccounting(req.workspace));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
