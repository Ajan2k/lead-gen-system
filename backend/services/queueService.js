const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config(); // Ensure env vars are loaded

// 👇 THE FIX: Add maxRetriesPerRequest: null
const connection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null  // <--- THIS LINE IS MANDATORY FOR BULLMQ
});

const emailQueue = new Queue('email-campaigns', { connection });

const addEmailJob = async (leadData) => {
    await emailQueue.add('send-welcome-email', leadData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }
    });
};

module.exports = { emailQueue, addEmailJob, connection };