// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');
const { analyzeIcpWithDataset } = require('./services/icpAnalysisService');

const app = express();
const server = http.createServer(app);

const { sendPersonalizedEmails } = require('./services/emailService');

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());

// Simple health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* -------------------------------------------------------------------------- */
/*                              1. ICP (LEADS) API                            */
/* -------------------------------------------------------------------------- */

// Get all ICPs
app.get('/api/leads', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM leads ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

// Create new ICP
app.post('/api/leads', async (req, res) => {
  try {
    const { profile_name, industry, revenue, location } = req.body;

    const query = `
      INSERT INTO leads (profile_name, industry, revenue, location, status)
      VALUES ($1, $2, $3, $4, 'Active')
      RETURNING *;
    `;
    const values = [
      profile_name,
      industry || 'General',
      revenue || 'Unknown',
      location || 'Global',
    ];

    const { rows } = await pool.query(query, values);
    const newLead = rows[0];

    io.emit('new-lead', newLead);

    res.status(201).json(newLead);
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// Get 100 recommended businesses for a specific ICP
// Also generates persona insights for that ICP using local templates.
app.get('/api/leads/:id/matches', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
    const icp = result.rows[0];

    if (!icp) {
      return res.status(404).json({ error: 'ICP not found' });
    }

    const matches = await analyzeIcpWithDataset(icp);
    res.json(matches);
  } catch (err) {
    console.error('Error building ICP matches:', err);
    res.status(500).json({ error: 'Failed to build matches' });
  }
});

/* -------------------------------------------------------------------------- */
/*                             2. PERSONAS (optional)                         */
/* -------------------------------------------------------------------------- */

app.get('/api/personas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT name FROM personas ORDER BY name ASC'
    );
    res.json(rows.map((r) => r.name));
  } catch (err) {
    console.error('Error fetching personas:', err);
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

app.post('/api/personas', async (req, res) => {
  try {
    const rawName = req.body.name || '';
    const name = rawName.trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const query = 'INSERT INTO personas (name) VALUES ($1) RETURNING name;';
    const { rows } = await pool.query(query, [name]);
    res.status(201).json({ name: rows[0].name });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Persona already exists' });
    }
    console.error('Error creating persona:', err);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

app.delete('/api/personas/:name', async (req, res) => {
  const rawName = req.params.name || '';
  const name = rawName.trim();
  if (!name) {
    return res.status(400).json({ error: 'Persona name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM persona_insights WHERE persona = $1', [
      name,
    ]);

    const { rowCount } = await client.query(
      'DELETE FROM personas WHERE name = $1',
      [name]
    );

    await client.query('COMMIT');
    client.release();

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Error deleting persona:', err);
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

/* -------------------------------------------------------------------------- */
/*                          3. PERSONA INSIGHTS API                           */
/* -------------------------------------------------------------------------- */

// Get insights for persona + icpId
app.get('/api/insights/:persona', async (req, res) => {
  try {
    const { persona } = req.params;
    const { icpId } = req.query;

    if (!icpId) {
      return res
        .status(400)
        .json({ error: 'icpId query parameter is required' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM persona_insights WHERE persona = $1 AND icp_id = $2 ORDER BY id DESC',
      [persona, icpId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Error fetching insights:', err);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Bulk save mapping status
app.put('/api/insights/bulk-status', async (req, res) => {
  const { updates } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of updates) {
      if (!u.id || !u.status) continue;
      await client.query(
        'UPDATE persona_insights SET status = $1 WHERE id = $2',
        [u.status, u.id]
      );
    }

    await client.query('COMMIT');
    client.release();

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Bulk status update failed:', err);
    res.status(500).json({ error: 'Bulk update failed' });
  }
});

// Add custom insight for ICP + persona
app.post('/api/insights/custom', async (req, res) => {
  try {
    let { icpId, industry, persona, title, description, type } = req.body;
    type = type || 'pain_point';

    if (!icpId || !persona || !title || !description) {
      return res.status(400).json({
        error: 'icpId, persona, title, and description are required',
      });
    }

    if (!['pain_point', 'outcome'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const query = `
      INSERT INTO persona_insights
      (icp_id, industry, persona, title, description, relevance_score, type, is_custom, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [
      icpId,
      (industry || 'General').trim(),
      persona.trim(),
      title.trim(),
      description.trim(),
      10,
      type,
      true,
      'unassigned',
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating custom insight:', err);
    res.status(500).json({ error: 'Failed to create custom insight' });
  }
});

// Delete a single insight
app.delete('/api/insights/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM persona_insights WHERE id = $1',
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Insight not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting insight:', err);
    res.status(500).json({ error: 'Failed to delete insight' });
  }
});

// Publish an email campaign to a list of leads using Brevo
app.post('/api/email/publish', async (req, res) => {
  try {
    const { subject, bodyTemplate, leads } = req.body;

    if (!subject || !bodyTemplate || !Array.isArray(leads)) {
      return res
        .status(400)
        .json({ error: 'subject, bodyTemplate and leads are required' });
    }

    const result = await sendPersonalizedEmails({
      subject,
      bodyTemplate,
      leads,
    });

    res.json(result);
  } catch (err) {
    console.error('Error sending campaign:', err);
    res.status(500).json({ error: 'Failed to send emails' });
  }
});

/* -------------------------------------------------------------------------- */

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});