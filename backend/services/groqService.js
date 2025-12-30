// backend/services/groqService.js
const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function createChatCompletion(prompt) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content:
          'You are a B2B go-to-market strategist. Always respond with ONLY valid JSON and no extra commentary.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.6,
  });

  return response;
}

// Helper to pull a JSON object out of the model text
function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(match[0]);
}

module.exports = { createChatCompletion, extractJson };