const pool = require('../config/db');
const { extractLeadDetails } = require('../services/groqService');
const { addEmailJob } = require('../services/queueService');

const handleZapierWebhook = async (req, res, io) => {
    try {
        const { raw_content, source_email } = req.body;

        // 1. AI Extraction
        const extractedData = await extractLeadDetails(raw_content);

        // 2. Save to DB
        const query = `
            INSERT INTO leads (profile_name, industry, revenue, location, email, raw_content)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [
            extractedData.profile_name,
            extractedData.industry,
            extractedData.revenue,
            extractedData.location,
            source_email,
            raw_content
        ];

        const result = await pool.query(query, values);
        const newLead = result.rows[0];

        // 3. Real-time Update
        io.emit('new-lead', newLead);

        // 4. Queue Background Email
        await addEmailJob(newLead);

        res.status(200).json({ success: true, lead: newLead });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ error: 'Processing failed' });
    }
};

module.exports = { handleZapierWebhook };