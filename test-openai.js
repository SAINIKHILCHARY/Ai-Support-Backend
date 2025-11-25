const axios = require('axios');
require('dotenv').config();

async function testOpenAI() {
    try {
        const OPENAI_KEY = process.env.OPENAI_API_KEY;
        console.log('Testing OpenAI Key:', OPENAI_KEY ? 'Present' : 'Missing');

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hello' }]
        }, {
            headers: { Authorization: `Bearer ${OPENAI_KEY}` }
        });

        console.log('Success:', response.data.choices[0].message.content);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testOpenAI();
