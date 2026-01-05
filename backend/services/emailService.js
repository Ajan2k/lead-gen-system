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

/**
 * Fetch aggregated Brevo SMTP stats for the last `days` days.
 * Returns metrics similar to the Brevo dashboard:
 * Events, Delivered, Opens, Clicks, Bounced.
 */
async function fetchBrevoAggregatedStats({ days = 1 } = {}) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY must be set in .env');
  }

  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const startDate = start.toISOString().slice(0, 10); // YYYY-MM-DD
  const endDate = now.toISOString().slice(0, 10);     // YYYY-MM-DD

  const url = 'https://api.brevo.com/v3/smtp/statistics/aggregatedReport';

  const resp = await axios.get(url, {
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
    },
    params: {
      startDate,
      endDate,
    },
  });

  const data = resp.data || {};

  const events = data.requests ?? 0;
  const delivered = data.delivered ?? 0;
  const opens = data.uniqueOpens ?? data.opens ?? 0;
  const clicks = data.uniqueClicks ?? data.clicks ?? 0;
  const softBounces = data.softBounces ?? 0;
  const hardBounces = data.hardBounces ?? 0;
  const bounced = softBounces + hardBounces;

  return {
    range: data.range || { from: startDate, to: endDate },
    events,
    delivered,
    opens,
    clicks,
    bounced,
    softBounces,
    hardBounces,
    raw: data,
  };
}

// IMPORTANT: export BOTH functions
module.exports = {
  sendPersonalizedEmails,
  fetchBrevoAggregatedStats,
};