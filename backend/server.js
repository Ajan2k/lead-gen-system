const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');
const { generatePainPoints } = require('./services/painPointService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// --- LEAD ROUTES ---
app.get('/api/leads', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/api/leads', async (req, res) => {
    try {
        const { profile_name, industry, revenue, location } = req.body;
        if (!profile_name) return res.status(400).json({ error: "Name required" });

        const query = `INSERT INTO leads (profile_name, industry, revenue, location, status) 
                       VALUES ($1, $2, $3, $4, 'Active') RETURNING *`;
        const values = [profile_name, industry || 'General', revenue || 'Any', location || 'Global'];

        const result = await pool.query(query, values);
        io.emit('new-lead', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to save lead" });
    }
});

// --- PAIN POINT ROUTES ---
app.post('/api/pain-points/generate', async (req, res) => {
    try {
        const { industry, persona } = req.body;
        const points = await generatePainPoints(industry, persona);
        res.json(points);
    } catch (err) {
        res.status(500).json({ error: "AI Generation failed" });
    }
});

app.post('/api/pain-points/save', async (req, res) => {
    try {
        const { industry, persona, selectedPoints } = req.body;
        const queries = selectedPoints.map(point => pool.query(
            'INSERT INTO pain_points (industry, persona, pain_point_title, description, relevance_score) VALUES ($1, $2, $3, $4, $5)',
            [industry, persona, point.title, point.description, point.relevance]
        ));
        await Promise.all(queries);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to save points" });
    }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));