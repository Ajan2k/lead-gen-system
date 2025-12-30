// backend/scripts/testBrevo.js
const path = require('path');
const axios = require('axios');

// Load the same .env your server uses
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

async function main() {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'LeadGen Test';

  if (!apiKey || !senderEmail) {
    console.error(
      '❌ BREVO_API_KEY or BREVO_SENDER_EMAIL not set in backend/.env'
    );
    process.exit(1);
  }

  // CHANGE THESE THREE ADDRESSES FOR YOUR TEST
  const recipients = [
    { email: 'ajanworks05@gmail.com', name: 'Test One' }
  ];

  const payload = {
    sender: {
      email: senderEmail,
      name: senderName,
    },
    to: recipients,
    subject: 'Test email from LeadGen / Brevo integration',
    htmlContent:
      '<html><body><h1>Hello from LeadGen</h1><p>This is a test email sent via Brevo API.</p></body></html>',
  };

  console.log('🔑 Using API key (first 6 chars):', apiKey.slice(0, 6), '...');
  console.log('📤 Sending test email to 3 recipients...');

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          accept: 'application/json',
        },
      }
    );

    console.log('✅ Brevo API response status:', response.status);
    console.log('Response data:', response.data);
  } catch (err) {
    if (err.response) {
      console.error('❌ Brevo error status:', err.response.status);
      console.error('Response data:', err.response.data);
    } else {
      console.error('❌ Request error:', err.message);
    }
  }
}

main();