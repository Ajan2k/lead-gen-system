const { Worker } = require('bullmq');
const { connection } = require('../services/queueService');

console.log('🚀 Mail Worker Started...');

const worker = new Worker('email-campaigns', async (job) => {
    console.log(`Processing email for ${job.data.email}...`);
    
    // Simulate sending email (Replace with Nodemailer/SendGrid code)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`✅ Email sent to ${job.data.email}`);
}, { connection });

worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job.id} failed: ${err.message}`);
});