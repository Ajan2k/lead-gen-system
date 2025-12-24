const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const generatePainPoints = async (industry, persona) => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a B2B sales expert. Generate 3 specific business pain points for the given industry and persona. 
                    Return ONLY a JSON array of objects with keys: title, description, and relevance (0-100).`
                },
                {
                    role: 'user',
                    content: `Industry: ${industry}, Persona: ${persona}`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
        });

        const content = completion.choices[0]?.message?.content || '[]';
        return JSON.parse(content.replace(/```json|```/g, ''));
    } catch (error) {
        console.error('Pain Point AI Error:', error);
        return [];
    }
};

module.exports = { generatePainPoints };