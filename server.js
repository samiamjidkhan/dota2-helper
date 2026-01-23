require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Import cors
const path = require('path'); // Import path module
// Lazy load dotaconstants to avoid issues with Vercel serverless function size
let dotaconstantsData = null;
function getDotaConstants() {
  if (!dotaconstantsData) {
    const dc = require('dotaconstants');
    dotaconstantsData = {
      heroes: dc.heroes,
      abilities: dc.abilities,
      hero_abilities: dc.hero_abilities,
      items: dc.items,
      patch: dc.patch
    };
  }
  return dotaconstantsData;
}

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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

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

// Get current patch version
function getCurrentPatch() {
  const { patch } = getDotaConstants();
  return patch[patch.length - 1]?.name || 'Unknown';
}

// Get hero abilities with current stats from dotaconstants
function getHeroAbilitiesContext(heroName) {
  const { heroes, hero_abilities, abilities } = getDotaConstants();
  const hero = Object.values(heroes).find(h => h.localized_name === heroName);
  if (!hero) return '';

  const heroAbilitiesData = hero_abilities[hero.name];
  if (!heroAbilitiesData) return '';
  const abilityDetails = heroAbilitiesData.abilities
    .map(abilityName => abilities[abilityName])
    .filter(a => a && a.dname && a.desc)
    .map(a => {
      let details = `**${a.dname}**: ${a.desc}`;
      if (a.attrib && a.attrib.length > 0) {
        const stats = a.attrib
          .filter(attr => attr.header || attr.key)
          .slice(0, 3) // Limit to 3 key stats
          .map(attr => {
            const value = Array.isArray(attr.value) ? attr.value.join('/') : attr.value;
            return `${attr.header || attr.key}: ${value}`;
          })
          .join(', ');
        if (stats) details += ` [${stats}]`;
      }
      return details;
    });

  // Add facets if available
  let facetInfo = '';
  if (heroAbilitiesData.facets && heroAbilitiesData.facets.length > 0) {
    const facets = heroAbilitiesData.facets
      .filter(f => f.title && f.description && !f.deprecated)
      .map(f => `${f.title}: ${f.description}`)
      .join('\n  - ');
    if (facets) facetInfo = `\nFacets:\n  - ${facets}`;
  }

  return abilityDetails.join('\n') + facetInfo;
}

// Get item data for commonly built items
function getItemContext(itemNames) {
  const { items } = getDotaConstants();
  return itemNames
    .map(name => {
      const item = items[name];
      if (!item || !item.dname) return null;

      let details = `**${item.dname}** (${item.cost} gold)`;

      // Add key attributes
      if (item.attrib && item.attrib.length > 0) {
        const attrs = item.attrib
          .filter(a => a.display || a.key)
          .slice(0, 4)
          .map(a => {
            const display = a.display ? a.display.replace('{value}', a.value) : `${a.key}: ${a.value}`;
            return display;
          })
          .join(', ');
        if (attrs) details += `: ${attrs}`;
      }

      // Add active/passive ability
      if (item.abilities && item.abilities.length > 0) {
        const ability = item.abilities[0];
        details += ` | ${ability.type}: ${ability.title}`;
      }

      return details;
    })
    .filter(Boolean)
    .join('\n');
}

// Debug endpoint to test components
app.get('/api/debug', async (req, res) => {
    const results = { timestamps: {} };

    try {
        // Test 1: Basic response
        results.timestamps.start = Date.now();
        results.step1_basic = 'OK';

        // Test 2: Load dotaconstants
        const dcStart = Date.now();
        const dc = getDotaConstants();
        results.timestamps.dotaconstants = Date.now() - dcStart;
        results.step2_dotaconstants = dc.patch ? 'OK' : 'FAILED';
        results.patch = dc.patch[dc.patch.length - 1]?.name;

        // Test 3: Simple Groq API call
        const groqStart = Date.now();
        const groqResponse = await axios.post(GROQ_API_URL, {
            model: 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
            max_completion_tokens: 10,
            reasoning_effort: 'low'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });
        results.timestamps.groq = Date.now() - groqStart;
        results.step3_groq = groqResponse.data.choices ? 'OK' : 'FAILED';
        results.groq_response = groqResponse.data.choices[0]?.message?.content;

        results.timestamps.total = Date.now() - results.timestamps.start;
        res.json(results);
    } catch (error) {
        results.error = error.message;
        results.timestamps.total = Date.now() - results.timestamps.start;
        res.status(500).json(results);
    }
});

// Common items by role for context
const ROLE_ITEMS = {
  'Safe Lane': ['power_treads', 'battle_fury', 'black_king_bar', 'butterfly', 'satanic', 'monkey_king_bar', 'daedalus', 'manta', 'disperser'],
  'Midlane': ['power_treads', 'bottle', 'black_king_bar', 'blink', 'orchid', 'bloodthorn', 'aghanims_shard', 'ultimate_scepter', 'sheepstick'],
  'Offlane': ['phase_boots', 'blink', 'blade_mail', 'black_king_bar', 'pipe', 'crimson_guard', 'lotus_orb', 'assault', 'heart'],
  'Support': ['arcane_boots', 'magic_wand', 'force_staff', 'glimmer_cape', 'aether_lens', 'aghanims_shard', 'ultimate_scepter', 'blink'],
  'Hard Support': ['arcane_boots', 'magic_wand', 'force_staff', 'glimmer_cape', 'ghost', 'solar_crest', 'aeon_disk', 'holy_locket']
};

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

    // Get current patch and game data from dotaconstants
    const currentPatch = getCurrentPatch();
    const yourHeroAbilities = getHeroAbilitiesContext(yourHeroName);
    const roleItems = ROLE_ITEMS[yourHeroRole] || ROLE_ITEMS['Support'];
    const itemContext = getItemContext(roleItems);

    // Format teams for the prompt
    const formatTeam = (team) => team.map(p => `${p.hero} (${p.role})`).join(', ');
    const myTeamFormatted = formatTeam(myTeam);
    const opponentTeamFormatted = formatTeam(opponentTeam);

    // Construct the *structured* prompt for the LLM
    const prompt = `
You are a Dota 2 expert coach, provide advice for playing ${yourHeroName} as the ${yourHeroRole} in a specific match.
My team composition is: ${myTeamFormatted}.
The opponent team composition is: ${opponentTeamFormatted}.

**Current Patch: ${currentPatch}**

**${yourHeroName}'s Current Abilities (Patch ${currentPatch}):**
${yourHeroAbilities}

**Available Items for ${yourHeroRole} (with current stats):**
${itemContext}

**Assume the player understands Dota 2 basics but is not an expert (e.g., around Archon/Legend rank or learning the hero). Explain key concepts clearly and prioritize standard item builds and reliable strategies based on the provided roles.**
**IMPORTANT: Use ONLY the items and ability values provided above. These are the current patch values.**

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
        console.log('Sending structured prompt to Groq (GPT-OSS 120B)...');
        const groqResponse = await axios.post(GROQ_API_URL, {
            model: 'openai/gpt-oss-120b',
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 1,
            max_completion_tokens: 8192,
            top_p: 1,
            reasoning_effort: 'low'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });

        console.log('Received response from Groq. Choices exist:', !!groqResponse.data.choices);

        const choices = groqResponse.data.choices;
        if (choices && choices.length > 0 && choices[0].message && choices[0].message.content) {
            const tips = choices[0].message.content;
            res.json({ tips });
        } else {
            console.error('Unexpected response structure from Groq:', JSON.stringify(groqResponse.data, null, 2));
            res.status(500).json({ error: 'Failed to parse response from AI model.' });
        }

    } catch (error) {
        console.error('Error calling Groq API: Status', error.response?.status);
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