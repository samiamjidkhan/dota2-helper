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

// --- Hardcoded Hero Data ---
const DOTA_HERO_NAMES = [
  "Abaddon", "Alchemist", "Ancient Apparition", "Anti-Mage", "Arc Warden", 
  "Axe", "Bane", "Batrider", "Beastmaster", "Bloodseeker", "Bounty Hunter", 
  "Brewmaster", "Bristleback", "Broodmother", "Centaur Warrunner", 
  "Chaos Knight", "Chen", "Clinkz", "Clockwerk", "Crystal Maiden", 
  "Dark Seer", "Dark Willow", "Dawnbreaker", "Dazzle", "Death Prophet", 
  "Disruptor", "Doom", "Dragon Knight", "Drow Ranger", "Earth Spirit", 
  "Earthshaker", "Elder Titan", "Ember Spirit", "Enchantress", "Enigma", 
  "Faceless Void", "Grimstroke", "Gyrocopter", "Hoodwink", "Huskar", 
  "Invoker", "Io", "Jakiro", "Juggernaut", "Keeper of the Light", 
  "Kunkka", "Legion Commander", "Leshrac", "Lich", "Lifestealer", "Lina", 
  "Lion", "Lone Druid", "Luna", "Lycan", "Magnus", "Marci", "Mars", 
  "Medusa", "Meepo", "Mirana", "Monkey King", "Morphling", "Muerta", 
  "Naga Siren", "Nature's Prophet", "Necrophos", "Night Stalker", "Nyx Assassin", 
  "Ogre Magi", "Omniknight", "Oracle", "Outworld Destroyer", "Pangolier", 
  "Phantom Assassin", "Phantom Lancer", "Phoenix", "Primal Beast", "Puck", 
  "Pudge", "Pugna", "Queen of Pain", "Razor", "Riki", "Rubick", 
  "Sand King", "Shadow Demon", "Shadow Fiend", "Shadow Shaman", "Silencer", 
  "Skywrath Mage", "Slardar", "Slark", "Snapfire", "Sniper", "Spectre", 
  "Spirit Breaker", "Storm Spirit", "Sven", "Techies", "Templar Assassin", 
  "Terrorblade", "Tidehunter", "Timbersaw", "Tinker", "Tiny", "Treant Protector", 
  "Troll Warlord", "Tusk", "Underlord", "Undying", "Ursa", "Vengeful Spirit", 
  "Venomancer", "Viper", "Visage", "Void Spirit", "Warlock", "Weaver", 
  "Windranger", "Winter Wyvern", "Witch Doctor", "Wraith King", "Zeus", "Ringmaster",
  "Kez"
].sort(); // Keep sorted for consistency

const VALID_HERO_NAMES_SET = new Set(DOTA_HERO_NAMES);

// Route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(staticFilesPath, 'index.html')); 
});

// --- API Routes --- 

// API route to get hero list (now uses hardcoded list)
app.get('/api/heroes', async (req, res) => {
    try {
        // Return list suitable for datalist (just names)
        const frontendHeroList = DOTA_HERO_NAMES.map(name => ({
             localized_name: name
             // No icon data available anymore
        }));
        res.json(frontendHeroList);
    } catch (error) {
         // Should ideally not happen with hardcoded list, but keep for safety
        console.error("Error sending hero list:", error);
        res.status(500).json({ error: 'Failed to provide hero list.' });
    }
});

// API route to get tips from Gemini
app.post('/api/get-tips', async (req, res) => {
    const { yourHero, allies, opponents } = req.body; 

    // --- Backend Validation (using hardcoded set) ---
    let allSelectedHeroes = [];
    try {
        if (!yourHero || !allies || !opponents || allies.length !== 4 || opponents.length !== 5) {
             return res.status(400).json({ error: 'Invalid input structure. Requires yourHero, 4 allies, 5 opponents.' });
        }
        
        allSelectedHeroes = [yourHero, ...allies, ...opponents];
        const uniqueHeroes = new Set();
        let validationError = null;

        for (const heroName of allSelectedHeroes) {
            const trimmedName = heroName?.trim(); // Handle potential non-strings safely
            if (!trimmedName) { // Check for empty or non-string values
                validationError = 'All hero selections must be non-empty valid names.';
                break;
            }
            if (!VALID_HERO_NAMES_SET.has(trimmedName)) { // Use the hardcoded set
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
        console.log('Backend validation passed for heroes:', allSelectedHeroes.join(', '));

    } catch (validationError) { // Catch any unexpected errors during validation itself
         console.error("Unexpected error during hero validation:", validationError);
         return res.status(500).json({ error: 'Server error during hero validation.' });
    }
    // --- End Backend Validation ---

    // Construct the *structured* prompt for the LLM (Keep the refined prompt)
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
(Provide a list of standard core items and key situational items, briefly explaining *why* they are good in this matchup for this skill level)

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

        console.log('Received response from Gemini. Candidates exist:', !!geminiResponse.data.candidates); 

        const candidates = geminiResponse.data.candidates;
        if (candidates && candidates.length > 0 && candidates[0].content && candidates[0].content.parts && candidates[0].content.parts.length > 0) {
            const tips = candidates[0].content.parts[0].text;
            res.json({ tips });
        } else {
            console.error('Unexpected response structure from Gemini:', JSON.stringify(geminiResponse.data, null, 2));
            let detail = 'Failed to parse response from AI model.';
            if (geminiResponse.data?.promptFeedback?.blockReason) {
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
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
}); 