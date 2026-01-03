// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = require('./config/db');

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

// Recommendations stub (no-op, just an empty list)
app.get('/api/leads/:id/matches', async (req, res) => {
  try {
    res.json([]);
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

    // Here you can send verification email via Brevo if you want.
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
app.post('/api/email/publish', async (req, res) => {
  try {
    const { userId, subject, leads } = req.body || {};

    if (!userId || !subject || !Array.isArray(leads)) {
      return res.status(400).json({
        error: 'userId, subject and leads are required',
      });
    }

    const sent = leads.filter((l) => l.email).length;
    const skipped = leads.length - sent;

    // For now, assume all sent = delivered, 0 bounces, 0 tracked.
    const delivered = sent;
    const softBounces = 0;
    const hardBounces = 0;
    const tracked = 0;

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
        skipped,
        delivered,
        softBounces,
        hardBounces,
        tracked,
      ]
    );

    res.json({
      sent,
      skipped,
      delivered,
      softBounces,
      hardBounces,
      tracked,
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
/*                6. PLACEHOLDERS FOR INSIGHTS API (SAFE STUBS)               */
/* -------------------------------------------------------------------------- */

app.get('/api/insights/:persona', async (req, res) => {
  res.json([]);
});

app.put('/api/insights/bulk-status', async (req, res) => {
  res.json({ success: true });
});

app.post('/api/insights/custom', async (req, res) => {
  res.status(201).json({
    id: Date.now(),
    ...req.body,
  });
});

app.delete('/api/insights/:id', async (req, res) => {
  res.status(204).send();
});

/* -------------------------------------------------------------------------- */

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});