require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client } = require('pg'); // Import PostgreSQL client

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// PostgreSQL client setup
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // This allows self-signed certificates; you may want to enable this in production
    },
});


client.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Connection error', err.stack));


app.get('/api/getleaderboard', async (req, res) => {
    console.log('hello');
    try {
        const result = await client.query('SELECT * FROM leaderboard ORDER BY score DESC LIMIT 10'); // Fetch top 10 scores
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Failed to retrieve leaderboard' });
    }
});
      
app.post('/api/leaderboard', async (req, res) => {
    const { name, score } = req.body;
    try {
        // Use UPSERT logic to handle both inserting and updating
        const query = `
            INSERT INTO leaderboard (name, score) 
            VALUES ($1, $2) 
            ON CONFLICT (name) 
            DO UPDATE SET score = GREATEST(leaderboard.score, EXCLUDED.score)
            RETURNING *;
        `;
        
        const result = await client.query(query, [name, score]);

        // If a new row is inserted or an existing row is updated, the result will not be empty
        if (result.rows.length > 0) {
            res.status(200).json({ message: 'Score processed successfully', score: result.rows[0].score });
        } else {
            res.status(400).json({ message: 'No score was processed' });
        }
    } catch (err) {
        console.error('Error processing score submission:', err);
        res.status(500).json({ error: 'Failed to process score submission' });
    }
});



app.post('/get-weight', async (req, res) => {
    const object = req.body.object;

    if (!object) {
        return res.status(400).json({ error: "Object name is required." });
    }

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `What is the average weight of a ${object} in kilograms? Respond with only an integer, with no words. If the weight is expressed as a power, please return it in the format 1Ex, where x is the exponent.` }],
            max_tokens: 10
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const messageContent = response.data.choices[0].message.content.trim();
        console.log('messageContent:', messageContent);

        // Enhanced regex to handle scientific notation in various formats
        const weightMatch = messageContent.match(/(\d+(\.\d+)?(e[+-]?\d+)?|\d+(\.\d+)?\s*x\s*10\^(\d+))/i);
        
        let weight;
        if (weightMatch) {
            weight = parseFloat(weightMatch[0].replace(/\s*x\s*10\^/, 'e'));
        } else {
            return res.status(400).json({ error: "Could not extract a valid weight." });
        }
        
        if (!isNaN(weight)) {
            return res.json({ weight });
        } else {
            return res.status(400).json({ error: "Could not find a valid weight in the response." });
        }
    } catch (error) {
        console.error('Error fetching weight:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: "Error fetching weight from OpenAI." });
    }
});


app.post('/generate-image', async (req, res) => {
    const { object } = req.body;

    if (!object) {
        return res.status(400).json({ error: "Object name is required." });
    }

    try {
        const searchQuery = `${object}`;

        const response = await axios.get('https://pixabay.com/api/', {
            params: {
                key: PIXABAY_API_KEY,
                q: searchQuery,
                image_type: 'photo',
                per_page: 5 // Fetch a few images to check for relevance
            }
        });

        if (response.data.hits.length > 0) {
            // Select the most relevant image
            const relevantImage = response.data.hits.find(hit => hit.tags.toLowerCase().includes(object.toLowerCase())) || response.data.hits[0];
            const imageUrl = relevantImage.webformatURL;
            return res.json({ imageUrl });
        } else {
            return res.status(404).json({ error: "No images found for the specified object." });
        }
    } catch (error) {
        console.error('Error fetching image from Pixabay:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: "Error fetching image from Pixabay." });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
