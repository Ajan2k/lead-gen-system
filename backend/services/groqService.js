// backend/services/groqService.js
const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, // put this in your .env
});

async function createChatCompletion(prompt) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content:
          'You are a B2B marketing strategist. Always respond with ONLY valid JSON, no extra text.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  });

  return response;
}

module.exports = { groq, createChatCompletion };