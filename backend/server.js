// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');
const { generatePersonaInsights } = require('./services/painPointService');

const app = express();
const server = http.createServer(app);

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

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

//
// 1. ICP LEADS ROUTES
//

// Get all leads (ICPs)
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

// Create a new lead (ICP)
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

//
// 2. PERSONA ROUTES (for custom personas)
//

/**
 * Get all custom personas (names).
 * We only store custom personas here; default personas are handled in FE.
 */
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

// Create new persona
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
      // unique_violation
      return res.status(409).json({ error: 'Persona already exists' });
    }
    console.error('Error creating persona:', err);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

// Delete persona and its insights
app.delete('/api/personas/:name', async (req, res) => {
  const rawName = req.params.name || '';
  const name = rawName.trim();
  if (!name) {
    return res.status(400).json({ error: 'Persona name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete associated insights
    await client.query('DELETE FROM persona_insights WHERE persona = $1', [
      name,
    ]);

    // Delete persona record
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

//
// 3. INSIGHTS / PERSONA ROUTES
//

// Generate AI insights for (industry, persona) and save to DB
app.post('/api/insights/generate', async (req, res) => {
  try {
    const rawIndustry = req.body.industry || '';
    const rawPersona = req.body.persona || '';

    const industry = rawIndustry.trim();
    const persona = rawPersona.trim();

    if (!industry || !persona) {
      return res
        .status(400)
        .json({ error: 'industry and persona are required' });
    }

    console.log(`🤖 Generating insights for "${persona}" in industry "${industry}"`);

    const data = await generatePersonaInsights(industry, persona);

    const insights = [
      ...data.pain_points.map((p) => ({ ...p, type: 'pain_point' })),
      ...data.outcomes.map((o) => ({ ...o, type: 'outcome' })),
    ];

    if (insights.length === 0) {
      return res.status(500).json({ error: 'AI returned no results' });
    }

    const values = insights.map((item) => [
      industry,
      persona,
      item.title,
      item.description,
      item.relevance || 8,
      item.type,
      false, // is_custom
      'unassigned',
    ]);

    const placeholders = values
      .map(
        (_, i) =>
          `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`
      )
      .join(',');

    const query = `
      INSERT INTO persona_insights
      (industry, persona, title, description, relevance_score, type, is_custom, status)
      VALUES ${placeholders}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values.flat());
    res.json(rows);
  } catch (err) {
    console.error('❌ Generation Error:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// Fetch insights for a persona, optionally by industry
app.get('/api/insights/:persona', async (req, res) => {
  try {
    const { persona } = req.params;
    const { industry } = req.query;

    let query = 'SELECT * FROM persona_insights WHERE persona = $1';
    const params = [persona];

    if (industry) {
      query += ' AND LOWER(industry) = LOWER($2)';
      params.push(industry);
    }

    query += ' ORDER BY id DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching insights:', err);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Bulk save mapping status (Save Mapping)
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

// Create a custom insight manually (pain point or outcome)
app.post('/api/insights/custom', async (req, res) => {
  try {
    let { industry, persona, title, description, type } = req.body;
    type = type || 'pain_point';

    if (!industry || !persona || !title || !description) {
      return res
        .status(400)
        .json({ error: 'industry, persona, title, description are required' });
    }

    if (!['pain_point', 'outcome'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const query = `
      INSERT INTO persona_insights
      (industry, persona, title, description, relevance_score, type, is_custom, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [
      industry.trim(),
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

// Delete a single insight (pain point or outcome)
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

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});