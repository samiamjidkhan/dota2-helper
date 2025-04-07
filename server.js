require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Import cors
const path = require('path'); // Import path module

const app = express();
// Use environment variable for port or default to 3002
const port = process.env.PORT || 3002; 

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// --- Serve Static Files --- 
// Serve static files (HTML, CSS, JS) from the current directory (__dirname)
const staticFilesPath = __dirname; 
app.use(express.static(staticFilesPath)); 

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-exp-03-25:generateContent?key=${GOOGLE_API_KEY}`;

// --- In-memory Cache for Hero Data ---
let heroCache = {
    heroes: [],
    validNames: new Set(),
    nameToData: {},
    lastFetched: 0,
    cacheDuration: 3600000 // Cache for 1 hour (in milliseconds)
};

async function getHeroData() {
    const now = Date.now();
    if (now - heroCache.lastFetched < heroCache.cacheDuration && heroCache.heroes.length > 0) {
        console.log("Using cached hero data.");
        return heroCache;
    }
    
    try {
        console.log("Fetching fresh hero data from OpenDota...");
        const response = await axios.get(`https://api.opendota.com/api/heroes`);
        const sortedHeroes = response.data.sort((a, b) => a.localized_name.localeCompare(b.localized_name));
        
        const validNames = new Set();
        const nameToData = {};
        sortedHeroes.forEach(hero => {
            validNames.add(hero.localized_name);
            // Store relevant data, including image URLs relative to the OpenDota CDN
            nameToData[hero.localized_name] = {
                 id: hero.id,
                 icon: `https://cdn.cloudflare.steamstatic.com${hero.icon}`, // Construct full URL
                 img: `https://cdn.cloudflare.steamstatic.com${hero.img}`   // Construct full URL
            };
        });

        heroCache = {
            heroes: sortedHeroes,
            validNames: validNames,
            nameToData: nameToData,
            lastFetched: now,
            cacheDuration: heroCache.cacheDuration
        };
        console.log(`Hero data cached. ${heroCache.validNames.size} heroes loaded.`);
        return heroCache;
    } catch (error) {
        console.error('FATAL: Error fetching hero data from OpenDota:', error.message);
        // If cache exists but is stale, return stale cache instead of failing completely
        if (heroCache.heroes.length > 0) {
             console.warn("Returning stale hero cache due to fetch error.");
             return heroCache;
        }
        throw new Error('Failed to fetch essential hero data.'); // Rethrow if no cache available
    }
}

// Route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(staticFilesPath, 'index.html')); 
});

// --- API Routes --- 

// API route to get hero list (uses cache)
app.get('/api/heroes', async (req, res) => {
    try {
        const data = await getHeroData();
        // Send only necessary data to frontend (name, icon)
        const frontendHeroList = data.heroes.map(hero => ({
             localized_name: hero.localized_name,
             icon: data.nameToData[hero.localized_name].icon // Send full icon URL
        }));
        res.json(frontendHeroList);
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch hero data.' });
    }
});

// API route to get tips from Gemini
app.post('/api/get-tips', async (req, res) => {
    const { yourHero, allies, opponents } = req.body; 

    // --- Backend Validation ---
    let allSelectedHeroes = [];
    try {
        const { validNames } = await getHeroData(); // Get valid names from cache/fetch

        if (!yourHero || !allies || !opponents || allies.length !== 4 || opponents.length !== 5) {
             return res.status(400).json({ error: 'Invalid input structure. Requires yourHero, 4 allies, 5 opponents.' });
        }
        
        allSelectedHeroes = [yourHero, ...allies, ...opponents];
        const uniqueHeroes = new Set();
        let validationError = null;

        for (const heroName of allSelectedHeroes) {
            if (!heroName || typeof heroName !== 'string' || heroName.trim() === '') {
                validationError = 'All hero selections must be non-empty strings.';
                break;
            }
            const trimmedName = heroName.trim();
            if (!validNames.has(trimmedName)) {
                validationError = `Invalid hero name received: "${trimmedName}".`;
                break;
            }
            if (uniqueHeroes.has(trimmedName)) {
                validationError = `Duplicate hero detected: "${trimmedName}".`;
                break;
            }
            uniqueHeroes.add(trimmedName);
        }

        if (validationError) {
            console.warn('Backend validation failed:', validationError);
            return res.status(400).json({ error: validationError });
        }
        // If validation passes, continue
        console.log('Backend validation passed for heroes:', allSelectedHeroes.join(', '));

    } catch (heroDataError) {
         // Handle error during hero data fetch for validation
         console.error("Error fetching hero data for validation:", heroDataError.message);
         return res.status(500).json({ error: 'Server error during hero validation.' });
    }
    // --- End Backend Validation ---


    // Construct the *structured* prompt for the LLM
    const prompt = `
As a Dota 2 expert coach, provide advice for playing ${yourHero} in a specific match.
My allies are: ${allies.join(', ')}.
My opponents are: ${opponents.join(', ')}.

**Assume the player understands Dota 2 basics but is not an expert (e.g., around Archon/Legend rank or learning the hero). Explain key concepts clearly and prioritize standard item builds and reliable strategies.**

Please structure your advice clearly using the following Markdown headings exactly:

### Overview & Core Strategy
(Brief summary of the overall game plan for ${yourHero} in this matchup, focusing on the most important goals for a less experienced player)

### Early Game (Laning Phase)
(Tips for the first ~10 minutes, including standard starting items, basic laning approach, simple kill opportunities, and common threats to avoid)

### Mid Game (~10-25 minutes)
(Focus on safe objectives, core item progression, basic positioning in teamfights, and when to join fights vs. farm)

### Late Game (25+ minutes)
(Standard late-game item choices, simplified teamfight role, focusing on key objectives like Roshan or defending high ground, and 1-2 critical opponent abilities to be aware of)

### Item Build Suggestions
(Provide a concise list of standard core items and 1-2 key situational items, briefly explaining *why* they are good in this matchup for this skill level)

### Key Matchup Considerations
(Highlight 1-2 crucial interactions, counters, or synergies most relevant to a beginner/intermediate player in this specific matchup)

Be specific and actionable, but avoid overly complex or highly advanced tactics. Explain the reasoning simply. Focus on advice relevant to this exact lineup configuration. Avoid generic hero descriptions.
`;

    try {
        console.log('Sending structured prompt to Gemini...'); 
        const geminiResponse = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        }, {
             headers: { 'Content-Type': 'application/json' }
        });

        // Log only part of the response data for brevity in logs
        console.log('Received response from Gemini. Candidates exist:', !!geminiResponse.data.candidates); 

        const candidates = geminiResponse.data.candidates;
        if (candidates && candidates.length > 0 && candidates[0].content && candidates[0].content.parts && candidates[0].content.parts.length > 0) {
            const tips = candidates[0].content.parts[0].text;
            res.json({ tips });
        } else {
            console.error('Unexpected response structure from Gemini:', JSON.stringify(geminiResponse.data, null, 2)); // Log full structure on error
            // Check for specific Gemini error messages
            let detail = 'Failed to parse response from AI model.';
            if (geminiResponse.data && geminiResponse.data.promptFeedback && geminiResponse.data.promptFeedback.blockReason) {
                 detail = `AI model blocked the prompt. Reason: ${geminiResponse.data.promptFeedback.blockReason}`;
                 if(geminiResponse.data.promptFeedback.safetyRatings) {
                    detail += ` Details: ${JSON.stringify(geminiResponse.data.promptFeedback.safetyRatings)}`;
                 }
            }
            res.status(500).json({ error: detail });
        }

    } catch (error) {
        console.error('Error calling Gemini API: Status', error.response?.status);
        console.error(error.response?.data ? JSON.stringify(error.response.data) : error.message);
        
        let errorMessage = 'Failed to get tips from AI model.';
        if (error.response?.data?.error?.message) {
            errorMessage = `AI Model Error: ${error.response.data.error.message}`;
        } else if (error.response?.status) {
            errorMessage = `AI Model request failed with status: ${error.response.status}`;
        }
        res.status(error.response?.status || 500).json({ error: errorMessage });
    }
});

// --- Start Server --- 
// Initialize hero cache on startup (don't await, let it happen in background)
getHeroData().catch(err => console.error("Initial hero data fetch failed:", err.message));

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
}); 