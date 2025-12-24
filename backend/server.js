const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const { generatePainPoints } = require('./services/painPointService');

// 👇 THE CRITICAL FIX: Import the database connection
const pool = require('./config/db'); 

const app = express();
const server = http.createServer(app);

// Setup Socket.io (Real-time connection)
const io = new Server(server, {
    cors: {
        origin: "*", // Allows your React Frontend to connect
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// 🟢 ROUTE 1: GET Leads (For your Frontend)
// ============================================
app.get('/api/leads', async (req, res) => {
    try {
        console.log("📥 Fetching leads from database...");
        // Fetch leads from DB, newest ones first
        const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
        
        console.log(`✅ Found ${result.rows.length} leads.`);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Database Error:", err.message);
        res.status(500).json({ error: "Server error" });
    }
});


app.post('/api/leads', async (req, res) => {
    try {
        const { profile_name, industry, revenue, location } = req.body;
        
        // Basic Validation
        if (!profile_name) {
            return res.status(400).json({ error: "Profile Name is required" });
        }

        const query = `
            INSERT INTO leads (profile_name, industry, revenue, location, status) 
            VALUES ($1, $2, $3, $4, 'Active') 
            RETURNING *`;
        
        const values = [profile_name, industry || 'General', revenue || 'Any', location || 'Global'];

        const result = await pool.query(query, values);
        const newLead = result.rows[0];

        // Notify frontend in real-time
        io.emit('new-lead', newLead);
        
        res.status(201).json(newLead);
    } catch (err) {
        console.error("Error saving lead:", err.message);
        res.status(500).json({ error: "Failed to save data" });
    }
});


// ============================================
// 🟡 ROUTE 2: POST Webhook (For Zapier)
// ============================================
app.post('/api/webhooks/zapier', async (req, res) => {
    try {
        console.log("📨 New Webhook received!");
        const { profile_name, industry, revenue, location, status } = req.body;

        // Save to Database
        const query = `
            INSERT INTO leads (profile_name, industry, revenue, location, status) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        
        const values = [
            profile_name || "Unknown Profile", 
            industry || "General", 
            revenue || "Unknown", 
            location || "Unknown", 
            status || 'Active'
        ];

        const result = await pool.query(query, values);
        const newLead = result.rows[0];

        // 🚀 TRIGGER REAL-TIME UPDATE
        io.emit('new-lead', newLead);
        console.log("✅ Lead saved & sent to Dashboard:", newLead.profile_name);

        res.status(201).json({ success: true, lead: newLead });
    } catch (err) {
        console.error("❌ Webhook Error:", err.message);
        res.status(500).json({ error: "Failed to store lead" });
    }
});


const { generatePainPoints } = require('./services/painPointService');

// Generate Pain Points
app.post('/api/pain-points/generate', async (req, res) => {
    const { industry, persona } = req.body;
    const points = await generatePainPoints(industry, persona);
    res.json(points);
});

// Save Selected Pain Points
app.post('/api/pain-points/save', async (req, res) => {
    try {
        const { industry, persona, selectedPoints } = req.body;
        const queries = selectedPoints.map(point => {
            return pool.query(
                'INSERT INTO pain_points (industry, persona, pain_point_title, description, relevance_score) VALUES ($1, $2, $3, $4, $5)',
                [industry, persona, point.title, point.description, point.relevance]
            );
        });
        await Promise.all(queries);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Start the Server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});