// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = require('./config/db');
const {
  analyzeIcpWithDatasetAndGroq,
} = require('./services/icpAnalysisService');

const {
  sendPersonalizedEmails,
  fetchBrevoAggregatedStats,
} = require('./services/emailService');

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

const VALID_ROLES = ['admin', 'user', 'influencer'];

function sanitizeRole(role) {
  const r = (role || '').toLowerCase();
  return VALID_ROLES.includes(r) ? r : null;
}

/* -------------------------------------------------------------------------- */
/*                                  AUTH API                                  */
/* -------------------------------------------------------------------------- */

app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      email,
      password,
      role,
      fullName,
      platforms,
      followers,
      category,
      handle,
      chargePerPost,
      imageUrl,
      mobileNumber,
    } = req.body || {};

    if (!email || !password || !role) {
      return res
        .status(400)
        .json({ error: 'email, password and role are required' });
    }

    const normalizedRole = sanitizeRole(role);
    if (!normalizedRole) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const lowerEmail = email.toLowerCase().trim();

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND role = $2',
      [lowerEmail, normalizedRole]
    );
    if (existing.rows[0]) {
      return res
        .status(409)
        .json({ error: 'User with this email and role already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertUser = await pool.query(
      `
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, $3)
        RETURNING id, email, role, created_at
      `,
      [lowerEmail, passwordHash, normalizedRole]
    );

    const user = insertUser.rows[0];

    // For influencers, also create an influencer profile row
    if (normalizedRole === 'influencer') {
      const platformString = Array.isArray(platforms)
        ? platforms.join(' & ')
        : platforms || '';

      await pool.query(
        `
          INSERT INTO influencers
            (name, email, platform, followers, category, handle, charge_per_post, image_url, mobile_number, verified)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
        `,
        [
          fullName || lowerEmail,
          lowerEmail,
          platformString,
          followers ? Number(followers) : null,
          category || 'General',
          handle || null,
          chargePerPost ? Number(chargePerPost) : null,
          imageUrl || null,
          mobileNumber || null,
        ]
      );
    }

    return res.status(201).json({ user });
  } catch (err) {
    console.error('Error in /api/auth/register:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body || {};

    if (!email || !password || !role) {
      return res
        .status(400)
        .json({ error: 'email, password and role are required' });
    }

    const normalizedRole = sanitizeRole(role);
    if (!normalizedRole) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const lowerEmail = email.toLowerCase().trim();

    const query = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND role = $2',
      [lowerEmail, normalizedRole]
    );
    const userRow = query.rows[0];

    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, userRow.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = {
      id: userRow.id,
      email: userRow.email,
      role: userRow.role,
      created_at: userRow.created_at,
    };

    return res.json({ user });
  } catch (err) {
    console.error('Error in /api/auth/login:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* -------------------------------------------------------------------------- */
/*                         2. ICP / LEADS (USER ROLE)                         */
/* -------------------------------------------------------------------------- */

// Each user sees only their own leads:
// GET /api/leads?userId=123
app.get('/api/leads', async (req, res) => {
  try {
    const { userId } = req.query;

    let query = 'SELECT * FROM leads';
    const params = [];

    if (userId) {
      query += ' WHERE user_id = $1';
      params.push(Number(userId));
    }

    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

// POST /api/leads  body: { profile_name, industry, revenue, location, userId }
app.post('/api/leads', async (req, res) => {
  try {
    const { profile_name, industry, revenue, location, userId } = req.body;

    if (!profile_name || !userId) {
      return res
        .status(400)
        .json({ error: 'profile_name and userId are required' });
    }

    const query = `
      INSERT INTO leads (user_id, profile_name, industry, revenue, location, status)
      VALUES ($1, $2, $3, $4, $5, 'Active')
      RETURNING *;
    `;
    const values = [
      Number(userId),
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

// GET /api/leads/:id/matches
// Option B: Use icpAnalysisService -> dataset + Groq-driven persona insights
app.get('/api/leads/:id/matches', async (req, res) => {
  try {
    const icpId = Number(req.params.id);
    if (!icpId) {
      return res.status(400).json({ error: 'Invalid ICP id' });
    }

    // 1. Load the ICP definition from the "leads" table
    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [
      icpId,
    ]);
    const icp = rows[0];
    if (!icp) {
      return res.status(404).json({ error: 'ICP not found' });
    }

    // 2. Analyze ICP with dataset + Groq (also ensures persona_insights once)
    const companies = await analyzeIcpWithDatasetAndGroq(icp);

    // 3. Return companies in the shape the frontend expects
    res.json(companies);
  } catch (err) {
    console.error('Error building ICP matches:', err);
    res.status(500).json({ error: 'Failed to build matches' });
  }
});

/* -------------------------------------------------------------------------- */
/*                        3. INFLUENCER MARKETING API                         */
/* -------------------------------------------------------------------------- */

// Direct influencer insert (not used by UI; main path is via auth/register)
app.post('/api/influencers', async (req, res) => {
  try {
    let {
      name,
      email,
      platform,
      followers,
      category,
      handle,
      charge_per_post,
      image_url,
      mobile_number,
    } = req.body || {};

    if (!name || !email || !platform || !category) {
      return res
        .status(400)
        .json({ error: 'name, email, platform, and category are required' });
    }

    const query = `
      INSERT INTO influencers
        (name, email, platform, followers, category, handle, charge_per_post, image_url, mobile_number, verified)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
      RETURNING *;
    `;

    const values = [
      name.trim(),
      email.trim(),
      platform.trim(),
      followers ? Number(followers) : null,
      category.trim(),
      handle ? handle.trim() : null,
      charge_per_post ? Number(charge_per_post) : null,
      image_url || null,
      mobile_number || null,
    ];

    const { rows } = await pool.query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating influencer:', err);
    res.status(500).json({ error: 'Failed to create influencer' });
  }
});

// List influencers (used by InfluencerMarketing + Admin views)
app.get('/api/influencers', async (req, res) => {
  try {
    const { category, platform, verified } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (category && category !== 'All') {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (platform && platform !== 'All') {
      conditions.push(`platform ILIKE $${idx++}`);
      params.push(`%${platform}%`);
    }
    if (verified === 'true') {
      conditions.push(`verified = true`);
    } else if (verified === 'false') {
      conditions.push(`verified = false`);
    }

    let query = 'SELECT * FROM influencers';
    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching influencers:', err);
    res.status(500).json({ error: 'Failed to fetch influencers' });
  }
});

app.put('/api/influencers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { charge_per_post, followers, handle, image_url, mobile_number } =
      req.body || {};

    const fields = [];
    const params = [];
    let idx = 1;

    if (charge_per_post !== undefined) {
      fields.push(`charge_per_post = $${idx++}`);
      params.push(
        charge_per_post === null ? null : Number(charge_per_post)
      );
    }
    if (followers !== undefined) {
      fields.push(`followers = $${idx++}`);
      params.push(followers === null ? null : Number(followers));
    }
    if (handle !== undefined) {
      fields.push(`handle = $${idx++}`);
      params.push(handle);
    }
    if (image_url !== undefined) {
      fields.push(`image_url = $${idx++}`);
      params.push(image_url);
    }
    if (mobile_number !== undefined) {
      fields.push(`mobile_number = $${idx++}`);
      params.push(mobile_number);
    }

    if (!fields.length) {
      return res
        .status(400)
        .json({ error: 'No updatable fields provided' });
    }

    params.push(id);

    const query = `
      UPDATE influencers
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, params);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Influencer not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating influencer:', err);
    res.status(500).json({ error: 'Failed to update influencer' });
  }
});

app.put('/api/influencers/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { verified } = req.body || {};
    const v = !!verified;

    const { rows } = await pool.query(
      'UPDATE influencers SET verified = $1 WHERE id = $2 RETURNING *',
      [v, id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Influencer not found' });
    }

    console.log(
      `Influencer ${rows[0].email} verification status changed to`,
      rows[0].verified
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Error verifying influencer:', err);
    res.status(500).json({ error: 'Failed to verify influencer' });
  }
});

// Stats for dashboards
app.get('/api/influencers/stats', async (req, res) => {
  try {
    const totalRes = await pool.query(
      'SELECT COUNT(*)::int AS total, SUM(CASE WHEN verified THEN 1 ELSE 0 END)::int AS verified FROM influencers'
    );
    const byCatRes = await pool.query(
      'SELECT category, COUNT(*)::int AS count FROM influencers GROUP BY category ORDER BY category'
    );

    res.json({
      total: totalRes.rows[0]?.total || 0,
      verified: totalRes.rows[0]?.verified || 0,
      byCategory: byCatRes.rows,
    });
  } catch (err) {
    console.error('Error fetching influencer stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/* -------------------------------------------------------------------------- */
/*                          4. EMAIL CAMPAIGNS (STATS)                        */
/* -------------------------------------------------------------------------- */

// Log campaigns (we are not sending externally, just tracking numbers)
// server.js
// Log campaigns AND send via Brevo
app.post('/api/email/publish', async (req, res) => {
  try {
    const { userId, subject, bodyTemplate, leads } = req.body || {};

    if (!userId || !subject || !bodyTemplate || !Array.isArray(leads)) {
      return res.status(400).json({
        error: 'userId, subject, bodyTemplate and leads are required',
      });
    }

    // Separate leads with and without email
    const leadsWithEmail = leads.filter((l) => l.email);
    const leadsWithoutEmail = leads.length - leadsWithEmail.length;

    // Send via Brevo
    let brevoResult;
    try {
      brevoResult = await sendPersonalizedEmails({
        subject,
        bodyTemplate,
        leads: leadsWithEmail,
      });
    } catch (err) {
      console.error('Error sending via Brevo:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to send emails via Brevo' });
    }

    const sent = brevoResult.sent || 0;
    const skippedInsideBrevo = brevoResult.skipped || 0;
    const totalSkipped = leadsWithoutEmail + skippedInsideBrevo;

    const delivered = sent;
    const softBounces = 0;
    const hardBounces = 0;
    const tracked = 0;

    // Log campaign stats in DB as before
    await pool.query(
      `
        INSERT INTO email_campaigns
          (user_id, subject, sent_count, skipped_count, delivered_count, soft_bounce_count, hard_bounce_count, tracked_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        Number(userId),
        subject,
        sent,
        totalSkipped,
        delivered,
        softBounces,
        hardBounces,
        tracked,
      ]
    );

    res.json({
      sent,
      skipped: totalSkipped,
      delivered,
      softBounces,
      hardBounces,
      tracked,
      errors: brevoResult.errors || [],
    });
  } catch (err) {
    console.error('Error in /api/email/publish:', err);
    res.status(500).json({ error: 'Failed to log campaign' });
  }
});
// GET /api/email/stats?userId=123  -> stats for user dashboard
app.get('/api/email/stats', async (req, res) => {
  try {
    const { userId } = req.query;

    let query = `
      SELECT
        COUNT(*)::int AS campaigns,
        COALESCE(SUM(sent_count),0)::int AS sent,
        COALESCE(SUM(skipped_count),0)::int AS skipped,
        COALESCE(SUM(delivered_count),0)::int AS delivered,
        COALESCE(SUM(soft_bounce_count),0)::int AS soft,
        COALESCE(SUM(hard_bounce_count),0)::int AS hard,
        COALESCE(SUM(tracked_count),0)::int AS tracked,
        MAX(created_at) AS last_at
      FROM email_campaigns
    `;
    const params = [];

    if (userId) {
      query += ' WHERE user_id = $1';
      params.push(Number(userId));
    }

    const { rows } = await pool.query(query, params);
    const row = rows[0] || {};

    res.json({
      totalCampaigns: row.campaigns || 0,
      totalSent: row.sent || 0,
      totalSkipped: row.skipped || 0,
      totalDelivered: row.delivered || 0,
      totalSoftBounces: row.soft || 0,
      totalHardBounces: row.hard || 0,
      totalTracked: row.tracked || 0,
      lastCampaignAt: row.last_at || null,
    });
  } catch (err) {
    console.error('Error fetching email stats:', err);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});


// GET /api/email/brevo-stats?days=1
// Returns aggregated SMTP stats from Brevo (account-wide)
app.get('/api/email/brevo-stats', async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 1;
    const stats = await fetchBrevoAggregatedStats({ days });
    res.json(stats);
  } catch (err) {
    console.error(
      'Error fetching Brevo stats:',
      err.response?.data || err.message
    );
    res.status(500).json({ error: 'Failed to fetch Brevo stats' });
  }
});


/* -------------------------------------------------------------------------- */
/*                                 5. ADMIN API                               */
/* -------------------------------------------------------------------------- */

app.get('/api/admin/overview', async (req, res) => {
  try {
    const usersRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM users'
    );
    const influencersRes = await pool.query(
      'SELECT COUNT(*)::int AS count, SUM(CASE WHEN verified THEN 1 ELSE 0 END)::int AS verified FROM influencers'
    );
    const byCatRes = await pool.query(
      'SELECT category, COUNT(*)::int AS count FROM influencers GROUP BY category ORDER BY category'
    );

    res.json({
      userCount: usersRes.rows[0]?.count || 0,
      influencerCount: influencersRes.rows[0]?.count || 0,
      verifiedInfluencers: influencersRes.rows[0]?.verified || 0,
      influencersByCategory: byCatRes.rows,
    });
  } catch (err) {
    console.error('Error fetching admin overview:', err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching admin users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/* -------------------------------------------------------------------------- */
/*                            6. INSIGHTS / PERSONAS                          */
/* -------------------------------------------------------------------------- */

// GET /api/insights/:persona?icpId=123
app.get('/api/insights/:persona', async (req, res) => {
  try {
    const persona = decodeURIComponent(req.params.persona);
    const icpId = Number(req.query.icpId);

    if (!icpId || !persona) {
      return res
        .status(400)
        .json({ error: 'icpId and persona are required' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        icp_id AS "icpId",
        industry,
        persona,
        title,
        description,
        relevance_score AS "relevance",
        type,
        is_custom AS "isCustom",
        status
      FROM persona_insights
      WHERE icp_id = $1 AND persona = $2
      ORDER BY relevance_score DESC, id ASC
      `,
      [icpId, persona]
    );

    res.json(rows);
  } catch (err) {
    console.error('Error fetching insights:', err);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// PUT /api/insights/bulk-status   { updates: [{id, status}, ...] }
app.put('/api/insights/bulk-status', async (req, res) => {
  try {
    const { updates } = req.body || {};
    if (!Array.isArray(updates) || !updates.length) {
      return res.status(400).json({ error: 'updates array is required' });
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
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating insight statuses:', err);
    res.status(500).json({ error: 'Failed to update insights' });
  }
});

// POST /api/insights/custom
app.post('/api/insights/custom', async (req, res) => {
  try {
    const {
      icpId,
      industry,
      persona,
      title,
      description,
      type,
    } = req.body || {};

    if (!icpId || !persona || !title || !description || !type) {
      return res.status(400).json({
        error: 'icpId, persona, title, description, and type are required',
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO persona_insights
        (icp_id, industry, persona, title, description, relevance_score, type, is_custom, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, TRUE, 'unassigned')
      RETURNING
        id,
        icp_id AS "icpId",
        industry,
        persona,
        title,
        description,
        relevance_score AS "relevance",
        type,
        is_custom AS "isCustom",
        status
      `,
      [
        Number(icpId),
        industry || 'General',
        persona,
        title,
        description,
        10, // default relevance for custom items
        type,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating custom insight:', err);
    res.status(500).json({ error: 'Failed to create custom insight' });
  }
});

// DELETE /api/insights/:id
app.delete('/api/insights/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    await pool.query('DELETE FROM persona_insights WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting insight:', err);
    res.status(500).json({ error: 'Failed to delete insight' });
  }
});

// Personas helpers (used by PersonaMapping for extra personas)
app.get('/api/personas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT persona FROM persona_insights ORDER BY persona'
    );
    const names = rows.map((r) => r.persona).filter(Boolean);
    res.json(names);
  } catch (err) {
    console.error('Error fetching personas:', err);
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

app.post('/api/personas', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    // No dedicated persona table for now; just acknowledge.
    res.status(201).json({ name: name.trim() });
  } catch (err) {
    console.error('Error creating persona:', err);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

app.delete('/api/personas/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    await pool.query('DELETE FROM persona_insights WHERE persona = $1', [
      name,
    ]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting persona:', err);
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

/* -------------------------------------------------------------------------- */

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});