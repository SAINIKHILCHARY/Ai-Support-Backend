const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();

async function testGemini() {
    try {
        const key = process.env.GEMINI_API_KEY;
        console.log('Testing Gemini Key:', key ? 'Present' : 'Missing');
        if (!key) return;

        const genAI = new GoogleGenerativeAI(key);
        // Using gemini-2.0-flash as found in the models list
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const result = await model.generateContent("Hello");
        const response = await result.response;
        const text = response.text();
        console.log('Success! Response:', text);
    } catch (error) {
        console.error('Error:', error);
        fs.writeFileSync('gemini-error.log', JSON.stringify(error, null, 2) + '\n' + error.stack);
    }
}

testGemini();
