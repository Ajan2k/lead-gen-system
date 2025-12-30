// backend/services/emailService.js
const axios = require('axios');
require('dotenv').config();

/**
 * Send personalized emails via Brevo HTTP API.
 * bodyTemplate may contain {{company}}, {{firstName}}, {{lastName}}.
 * leads: [{ email, businessName, firstName, lastName }, ...]
 */
async function sendPersonalizedEmails({ subject, bodyTemplate, leads }) {
  if (!subject || !bodyTemplate || !Array.isArray(leads)) {
    throw new Error('subject, bodyTemplate and leads are required');
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'LeadGen AI';

  if (!apiKey || !senderEmail) {
    throw new Error(
      'BREVO_API_KEY and BREVO_SENDER_EMAIL must be set in .env'
    );
  }

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const lead of leads) {
    const email = (lead.email || '').toString().trim();
    if (!email) {
      skipped++;
      continue;
    }

    const company = lead.businessName || 'your company';
    const firstName = lead.firstName || '';
    const lastName = lead.lastName || '';

    const personalizedBody = bodyTemplate
      .replace(/{{\s*company\s*}}/gi, company)
      .replace(/{{\s*firstName\s*}}/gi, firstName)
      .replace(/{{\s*lastName\s*}}/gi, lastName);

    const personalizedSubject = subject.replace(
      /{{\s*company\s*}}/gi,
      company
    );

    const payload = {
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [
        {
          email,
          name: `${firstName} ${lastName}`.trim() || company,
        },
      ],
      subject: personalizedSubject,
      htmlContent: `<html><body>${personalizedBody
        .split('\n')
        .map((l) => l.trim())
        .join('<br/>')}</body></html>`,
    };

    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
      });
      sent++;
    } catch (err) {
      console.error(
        'Brevo send error for',
        email,
        err.response?.status,
        err.response?.data || err.message
      );
      errors.push({
        email,
        error: err.response?.data || err.message,
      });
    }
  }

  return { sent, skipped, errors };
}

module.exports = { sendPersonalizedEmails };