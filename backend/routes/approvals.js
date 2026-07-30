// ==========================================
// Approvals / Checkpoints / Interactions Route
// ==========================================

const express = require('express');
const router = express.Router();

// POST /api/approvals/:id — Resolve approval
router.post('/approvals/:id', async (req, res) => {
  try {
    const decision = req.body.decision;
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision "approved" və ya "rejected" olmalıdır' });
    }
    const interaction = req.chatRuntime?.getInteraction(req.params.id);
    if (!interaction) return res.status(404).json({ error: 'Approval tapılmadı' });
    if (String(interaction.userId || '') !== String(req.user?.id || '')) {
      return res.status(404).json({ error: 'Approval tapılmadı' });
    }
    if (interaction.status !== 'pending') return res.status(400).json({ error: 'Bu approval artıq cavablandırılıb' });

    if (interaction._resolve) {
      interaction._resolve(decision);
    }
    res.json({ success: true, decision });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/checkpoints/:id — Resolve checkpoint
router.post('/checkpoints/:id', async (req, res) => {
  try {
    const decision = req.body.decision;
    if (!decision || !['resume', 'cancel'].includes(decision)) {
      return res.status(400).json({ error: 'decision "resume" və ya "cancel" olmalıdır' });
    }
    const pending = req.chatRuntime?.getInteraction(req.params.id);
    if (!pending || String(pending.userId || '') !== String(req.user?.id || '')) {
      return res.status(404).json({ error: 'Checkpoint tapılmadı' });
    }
    const checkpoint = req.chatRuntime?.resolveCheckpoint(req.params.id, decision);
    if (!checkpoint) return res.status(404).json({ error: 'Checkpoint tapılmadı' });

    res.json({ success: true, checkpoint, decision });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/interactions — List pending interactions
router.get('/interactions', async (req, res) => {
  try {
    const userInteractions = req.chatRuntime?.listInteractionsByUser(req.user?.id) || [];
    const pending = userInteractions.filter(i => i.status === 'pending' && (i.kind === 'approval' || i.kind === 'checkpoint'));
    res.json({ interactions: pending });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
