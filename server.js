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
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

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
    const { myTeam, opponentTeam } = req.body; 

    // --- Backend Validation ---
    let allSelectedHeroes = [];
    let validationError = null;
    try {
        if (!myTeam || !opponentTeam || myTeam.length !== 5 || opponentTeam.length !== 5) {
             return res.status(400).json({ error: 'Invalid input structure. Requires myTeam and opponentTeam arrays of size 5.' });
        }
        
        const allHeroesWithRoles = [...myTeam, ...opponentTeam];
        allSelectedHeroes = allHeroesWithRoles.map(h => h.hero);
        const uniqueHeroes = new Set();
        const requiredRoles = new Set(['Safe Lane', 'Midlane', 'Offlane', 'Support', 'Hard Support']);
        const teamRoles = new Set();

        for (const team of [myTeam, opponentTeam]) {
            teamRoles.clear(); // Reset for each team
            for (const { hero, role } of team) {
                const trimmedHero = hero?.trim();
                const trimmedRole = role?.trim();

                if (!trimmedHero || !trimmedRole) {
                    validationError = 'All hero and role selections must be non-empty.';
                    break;
                }
                if (!VALID_HERO_NAMES_SET.has(trimmedHero)) {
                    validationError = `Invalid hero name received: "${trimmedHero}".`;
                    break;
                }
                 if (!requiredRoles.has(trimmedRole)) {
                    validationError = `Invalid role received: "${trimmedRole}".`;
                    break;
                }
                if (uniqueHeroes.has(trimmedHero)) {
                    validationError = `Duplicate hero detected: "${trimmedHero}".`;
                    break;
                }
                 if (teamRoles.has(trimmedRole)) {
                    validationError = `Duplicate role detected on a team: "${trimmedRole}".`;
                    break;
                }
                uniqueHeroes.add(trimmedHero);
                teamRoles.add(trimmedRole);
            }
            if (validationError) break;
             if (teamRoles.size !== 5) { // Check if all 5 unique roles are present per team
                validationError = `Each team must have one of each role. Missing or duplicate roles found.`;
                break;
            }
        }

        if (validationError) {
            console.warn('Backend validation failed:', validationError);
            return res.status(400).json({ error: validationError });
        }
        console.log('Backend validation passed for heroes:', allSelectedHeroes.join(', '));

    } catch (err) { // Catch any unexpected errors during validation itself
         console.error("Unexpected error during hero validation:", err);
         return res.status(500).json({ error: 'Server error during hero validation.' });
    }
    // --- End Backend Validation ---

    // Find the user's hero and role from the validated myTeam array
    const yourHeroData = myTeam[0]; // By convention from the front-end
    const yourHeroName = yourHeroData.hero;
    const yourHeroRole = yourHeroData.role;

    // --- Determine Lane Matchups ---
    let laneMatchupInfo = '';
    const opponentSafelane = opponentTeam.find(p => p.role === 'Safe Lane')?.hero;
    const opponentMidlane = opponentTeam.find(p => p.role === 'Midlane')?.hero;
    const opponentOfflane = opponentTeam.find(p => p.role === 'Offlane')?.hero;
    const opponentSupport = opponentTeam.find(p => p.role === 'Support')?.hero;
    const opponentHardSupport = opponentTeam.find(p => p.role === 'Hard Support')?.hero;

    if (yourHeroRole === 'Safe Lane' || yourHeroRole === 'Hard Support') {
        laneMatchupInfo = `You will be laning against ${opponentOfflane} and ${opponentSupport}.`;
    } else if (yourHeroRole === 'Midlane') {
        laneMatchupInfo = `You will be laning against ${opponentMidlane}.`;
    } else if (yourHeroRole === 'Offlane' || yourHeroRole === 'Support') {
        laneMatchupInfo = `You will be laning against ${opponentSafelane} and ${opponentHardSupport}.`;
    }
    
    // Format teams for the prompt
    const formatTeam = (team) => team.map(p => `${p.hero} (${p.role})`).join(', ');
    const myTeamFormatted = formatTeam(myTeam);
    const opponentTeamFormatted = formatTeam(opponentTeam);

    // Construct the *structured* prompt for the LLM
    const prompt = `
You are a Dota 2 expert coach, provide advice for playing ${yourHeroName} as the ${yourHeroRole} in a specific match.
My team composition is: ${myTeamFormatted}.
The opponent team composition is: ${opponentTeamFormatted}.

**Assume the player understands Dota 2 basics but is not an expert (e.g., around Archon/Legend rank or learning the hero). Explain key concepts clearly and prioritize standard item builds and reliable strategies based on the provided roles.**
**IMPORTANT: Only suggest items currently available in the latest Dota 2 patch. Do NOT mention removed items.**

Please structure your advice clearly using the following Markdown headings exactly:

### Overview & Core Strategy
(Brief summary of the overall game plan for ${yourHeroName} in this matchup, focusing on the most important goals for a less experienced player in the ${yourHeroRole} position)

### Early Game (Laning Phase)
(Tips for the first ~10 minutes. ${laneMatchupInfo} Focus on standard starting items, basic laning approach against them, simple kill opportunities, and common threats to avoid)

### Mid Game (~10-25 minutes)
(Focus on safe objectives, core item progression, basic positioning in teamfights, and when to join fights vs. farm, all tailored to the ${yourHeroRole} role)

### Late Game (25+ minutes)
(Standard late-game item choices, simplified teamfight role, focusing on key objectives like Roshan or defending high ground, and 1-2 critical opponent abilities to be aware of, considering the ${yourHeroRole})

### Item Build Suggestions
(Provide a list of standard core items and key situational items *currently in the game*, explaining *why* they are good in this specific role and matchup for this skill level)

### Key Matchup Considerations
(Highlight 1-2 crucial interactions, counters, or synergies most relevant to a beginner/intermediate player in the ${yourHeroRole} role against the enemy team composition)

Be specific and actionable, but avoid overly complex or highly advanced tactics. Explain the reasoning simply. Focus on advice relevant to this exact lineup and role configuration. Avoid generic hero descriptions.
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