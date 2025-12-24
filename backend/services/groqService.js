const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const extractLeadDetails = async (rawText) => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a data extraction assistant. Extract the following fields from the email text:
                    - profile_name (Name of person or company)
                    - industry (Guess based on context)
                    - revenue (If mentioned, otherwise "Unknown")
                    - location (City/Country)
                    
                    Return ONLY a JSON object. Do not add markdown formatting.`
                },
                {
                    role: 'user',
                    content: rawText
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
        });

        const jsonString = completion.choices[0]?.message?.content || '{}';
        // Clean potential markdown code blocks if Groq adds them
        const cleanJson = jsonString.replace(/```json|```/g, '');
        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('Groq AI Error:', error);
        return { profile_name: 'Unknown', industry: 'General', revenue: 'Unknown', location: 'Unknown' };
    }
};

module.exports = { extractLeadDetails };