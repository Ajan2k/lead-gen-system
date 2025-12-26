// backend/services/painPointService.js
const { createChatCompletion } = require('./groqService');

function extractJson(text) {
  // Try to extract a JSON block from the model response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(match[0]);
}

/**
 * Calls Groq and returns:
 * {
 *   pain_points: [{ title, description, relevance }, ...],
 *   outcomes:    [{ title, description, relevance }, ...]
 * }
 */
async function generatePersonaInsights(industry, persona) {
  const prompt = `
Generate conversion-focused ICP insights for:
- Industry: ${industry}
- Persona: ${persona}

Return STRICTLY valid JSON with this shape:

{
  "pain_points": [
    { "title": "short title", "description": "1-2 sentence description", "relevance": 1-10 },
    ...
  ],
  "outcomes": [
    { "title": "short title", "description": "1-2 sentence description", "relevance": 1-10 },
    ...
  ]
}
  `.trim();

  try {
    const completion = await createChatCompletion(prompt);
    const content = completion.choices[0].message.content;
    const json = extractJson(content);

    if (!json.pain_points || !json.outcomes) {
      throw new Error('JSON missing pain_points or outcomes');
    }

    return json;
  } catch (err) {
    console.error('❌ Groq error, falling back to static data:', err.message);

    // Fallback data so the app still works without Groq configured
    return {
      pain_points: [
        {
          title: 'Manual reporting drains team productivity',
          description:
            'Teams spend hours consolidating data from different systems, delaying decision-making.',
          relevance: 9,
        },
        {
          title: 'Difficulty tracking full buyer journey',
          description:
            'Leads move between marketing and sales tools with no unified view of engagement.',
          relevance: 8,
        },
      ],
      outcomes: [
        {
          title: 'Automate 70% of manual reporting',
          description:
            'Dashboards auto-refresh from integrated systems, saving hours per week.',
          relevance: 9,
        },
        {
          title: 'Single source of truth for revenue data',
          description:
            'Leadership can see pipeline, conversion, and retention metrics in one place.',
          relevance: 8,
        },
      ],
    };
  }
}

module.exports = { generatePersonaInsights };