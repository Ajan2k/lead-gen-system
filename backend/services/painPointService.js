// backend/services/painPointService.js
const { createChatCompletion, extractJson } = require('./groqService');

/**
 * Generate persona insights (pain_points + outcomes) via Groq
 * for a specific ICP and persona.
 *
 * icp: { id, profile_name, industry, revenue, location }
 * persona: string
 *
 * Returns:
 * {
 *   pain_points: [{ title, description, relevance }, ...],
 *   outcomes: [{ title, description, relevance }, ...]
 * }
 */
async function generatePersonaInsights(icp, persona) {
  const name = (icp.profile_name || '').trim() || 'Unnamed ICP';
  const industry = (icp.industry || '').trim() || 'General';
  const revenue = (icp.revenue || '').trim() || 'Unknown';
  const location = (icp.location || '').trim() || 'Global';
  const personaName = (persona || '').trim() || 'Decision Maker';

  const prompt = `
You are a senior B2B marketing strategist.

You are given an Ideal Customer Profile (ICP) and a buyer persona.
Generate highly relevant, conversion-focused pain points and desired outcomes
for this *specific* ICP and persona.

ICP:
- Name: ${name}
- Industry: ${industry}
- Revenue: ${revenue}
- Location: ${location}

Persona: ${personaName}

Guidelines:
- Pain points must be concrete and financially/operationally meaningful.
- Desired outcomes must clearly tie back to pains.
- Tailor everything to this ICP's industry, revenue band, and location.
- Do NOT be generic.

Return STRICTLY valid JSON in this exact shape, no extra fields or text:

{
  "pain_points": [
    {
      "title": "short pain title (max 12 words)",
      "description": "2-3 sentence explanation of this pain in this ICP context",
      "relevance": 1-10
    }
  ],
  "outcomes": [
    {
      "title": "short outcome title (max 12 words)",
      "description": "2-3 sentence explanation of the dream result for this persona",
      "relevance": 1-10
    }
  ]
}
  `.trim();

  try {
    const completion = await createChatCompletion(prompt);
    const content = completion.choices[0].message.content;
    const data = extractJson(content);

    if (!data.pain_points || !data.outcomes) {
      throw new Error('JSON missing pain_points or outcomes');
    }

    return data;
  } catch (err) {
    console.error('❌ Groq error generating persona insights:', err.message);
    // NO static fallback – just return empty so nothing is saved
    return {
      pain_points: [],
      outcomes: [],
    };
  }
}

module.exports = { generatePersonaInsights };