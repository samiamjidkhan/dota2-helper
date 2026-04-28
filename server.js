require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Import cors
const path = require('path'); // Import path module
const { Redis } = require('@upstash/redis');
const Stripe = require('stripe');
const crypto = require('crypto');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const APP_URL = process.env.APP_URL || 'https://www.dota2helper.com';
const FREE_TIER_LIMIT = 3;

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const redis = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

if (!stripe) console.warn('STRIPE_SECRET_KEY not set — payment endpoints will not work');
if (!redis) console.warn('Redis not configured — rate limiting will be disabled');
// Lazy load dotaconstants using dynamic import (ES Module compatible)
let dotaconstantsData = null;
async function getDotaConstants() {
  if (!dotaconstantsData) {
    const dc = await import('dotaconstants');
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
app.use('/api/webhook', express.raw({ type: 'application/json' })); // Raw body for Stripe webhook verification
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
async function getCurrentPatch() {
  const { patch } = await getDotaConstants();
  return patch[patch.length - 1]?.name || 'Unknown';
}

// Get hero abilities with current stats from dotaconstants
async function getHeroAbilitiesContext(heroName) {
  const { heroes, hero_abilities, abilities } = await getDotaConstants();
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
async function getItemContext(itemNames) {
  const { items } = await getDotaConstants();
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
        const dc = await getDotaConstants();
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

// Get brief enemy abilities (key threats to watch)
async function getEnemyAbilitiesBrief(heroNames) {
  const { heroes, hero_abilities, abilities } = await getDotaConstants();

  return heroNames.map(heroName => {
    const hero = Object.values(heroes).find(h => h.localized_name === heroName);
    if (!hero) return null;

    const heroAbilitiesData = hero_abilities[hero.name];
    if (!heroAbilitiesData) return null;

    // Get ultimate and one key basic ability
    const abilityList = heroAbilitiesData.abilities
      .map(name => abilities[name])
      .filter(a => a && a.dname && a.behavior !== 'Passive');

    const ultimate = abilityList.find(a => a.ultimate);
    const keyAbility = abilityList.find(a => !a.ultimate && a.desc);

    let result = `**${heroName}**: `;
    if (keyAbility) result += `${keyAbility.dname} - ${keyAbility.desc?.slice(0, 100)}...`;
    if (ultimate) result += ` | ULT: ${ultimate.dname}`;

    return result;
  }).filter(Boolean).join('\n');
}

// Common items by role for context (including starting items)
const ROLE_ITEMS = {
  'Safe Lane': ['tango', 'quelling_blade', 'slippers', 'branches', 'magic_wand', 'power_treads', 'battle_fury', 'black_king_bar', 'butterfly', 'satanic', 'manta', 'disperser'],
  'Midlane': ['tango', 'faerie_fire', 'branches', 'bottle', 'magic_wand', 'power_treads', 'black_king_bar', 'blink', 'orchid', 'bloodthorn', 'aghanims_shard', 'ultimate_scepter'],
  'Offlane': ['tango', 'quelling_blade', 'ring_of_protection', 'branches', 'magic_wand', 'phase_boots', 'soul_ring', 'blink', 'blade_mail', 'black_king_bar', 'pipe', 'lotus_orb', 'assault'],
  'Support': ['tango', 'blood_grenade', 'enchanted_mango', 'branches', 'magic_wand', 'arcane_boots', 'force_staff', 'glimmer_cape', 'aghanims_shard', 'ultimate_scepter', 'blink'],
  'Hard Support': ['tango', 'clarity', 'blood_grenade', 'branches', 'magic_wand', 'arcane_boots', 'force_staff', 'glimmer_cape', 'ghost', 'solar_crest', 'aeon_disk']
};

// Route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(staticFilesPath, 'index.html')); 
});

// --- Rate Limiting Middleware ---
async function rateLimitMiddleware(req, res, next) {
  // If Redis is not configured, skip rate limiting
  if (!redis) return next();

  // Check for Pro token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const tokenData = await redis.get(`token:${token}`);
      if (tokenData && tokenData.status === 'active') {
        req.isPro = true;
        return next();
      }
    } catch (err) {
      console.error('Redis error checking token:', err);
    }
  }

  // IP-based rate limiting for free tier (check only, don't increment yet)
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const key = `ratelimit:${ip}`;

  try {
    const current = (await redis.get(key)) || 0;

    if (current >= FREE_TIER_LIMIT) {
      return res.status(429).json({
        error: 'Daily free limit reached. Upgrade to Pro for unlimited queries.',
        remaining: 0,
        limit: FREE_TIER_LIMIT
      });
    }

    req.isPro = false;
    req.rateLimitKey = key;
    req.queriesRemaining = FREE_TIER_LIMIT - current - 1; // will be decremented after success
    next();
  } catch (err) {
    console.error('Redis rate limit error:', err);
    // Fail open — don't break the app if Redis is down
    next();
  }
}

// --- Stripe Endpoints ---

app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured.' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

app.post('/api/create-portal-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured.' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const token = authHeader.substring(7);

  try {
    const tokenData = await redis.get(`token:${token}`);
    if (!tokenData || !tokenData.stripeCustomerId) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tokenData.stripeCustomerId,
      return_url: APP_URL,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal session error:', err);
    res.status(500).json({ error: 'Failed to create portal session.' });
  }
});

app.post('/api/webhook', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured.' });
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const email = session.customer_details?.email || session.customer_email;

        const token = crypto.randomUUID();

        await redis.set(`token:${token}`, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          email: email,
          status: 'active',
          createdAt: new Date().toISOString()
        });

        await redis.set(`customer:${customerId}`, token);
        if (email) {
          await redis.set(`email:${email.toLowerCase()}`, customerId);
        }

        console.log(`New subscription: ${customerId}, token: ${token}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const token = await redis.get(`customer:${customerId}`);
        if (token) {
          const tokenData = await redis.get(`token:${token}`);
          if (tokenData) {
            const newStatus = subscription.status === 'active' ? 'active' : 'inactive';
            await redis.set(`token:${token}`, { ...tokenData, status: newStatus });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const token = await redis.get(`customer:${customerId}`);
        if (token) {
          const tokenData = await redis.get(`token:${token}`);
          if (tokenData) {
            await redis.set(`token:${token}`, { ...tokenData, status: 'inactive' });
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  res.json({ received: true });
});

app.get('/api/checkout-success', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured.' });
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const customerId = session.customer;
    const token = await redis.get(`customer:${customerId}`);

    if (!token) {
      return res.status(202).json({ error: 'Processing payment. Please retry in a moment.' });
    }

    res.json({ token });
  } catch (err) {
    console.error('Checkout success error:', err);
    res.status(500).json({ error: 'Failed to retrieve subscription.' });
  }
});

app.get('/api/subscription-status', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ active: false });
  }
  const token = authHeader.substring(7);

  try {
    const tokenData = await redis.get(`token:${token}`);
    if (tokenData && tokenData.status === 'active') {
      return res.json({ active: true, email: tokenData.email });
    }
    return res.json({ active: false });
  } catch (err) {
    console.error('Status check error:', err);
    return res.json({ active: false });
  }
});

app.post('/api/recover-token', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const customerId = await redis.get(`email:${email.toLowerCase().trim()}`);
    if (!customerId) {
      return res.status(404).json({ error: 'No subscription found for this email.' });
    }

    const token = await redis.get(`customer:${customerId}`);
    if (!token) {
      return res.status(404).json({ error: 'Subscription token not found.' });
    }

    const tokenData = await redis.get(`token:${token}`);
    if (!tokenData || tokenData.status !== 'active') {
      return res.status(404).json({ error: 'Subscription is no longer active.' });
    }

    res.json({ token });
  } catch (err) {
    console.error('Token recovery error:', err);
    res.status(500).json({ error: 'Failed to recover token.' });
  }
});

// --- Match Analysis (Pro-only) ---

// Map item IDs to readable names from dotaconstants
async function formatPlayerItems(player) {
  const { items } = await getDotaConstants();
  const itemSlots = ['item_0', 'item_1', 'item_2', 'item_3', 'item_4', 'item_5'];
  const itemIds = itemSlots.map(slot => player[slot]).filter(id => id && id !== 0);

  // dotaconstants items is keyed by name; need to look up by ID
  const itemNames = itemIds.map(id => {
    const item = Object.values(items).find(i => i.id === id);
    return item?.dname || null;
  }).filter(Boolean);

  return itemNames.length ? itemNames.join(', ') : 'No major items';
}

const LANE_NAMES = { 1: 'Safe Lane', 2: 'Mid Lane', 3: 'Off Lane', 4: 'Jungle' };

app.post('/api/analyze-match', async (req, res) => {
  // Pro-only: require active token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Pro subscription required for match analysis.' });
  }
  const token = authHeader.substring(7);

  if (!redis) return res.status(503).json({ error: 'Service unavailable.' });

  try {
    const tokenData = await redis.get(`token:${token}`);
    if (!tokenData || tokenData.status !== 'active') {
      return res.status(403).json({ error: 'Pro subscription required for match analysis.' });
    }
  } catch (err) {
    console.error('Token check error:', err);
    return res.status(500).json({ error: 'Authentication error.' });
  }

  const { match_id, hero } = req.body;

  if (!match_id || !/^\d+$/.test(String(match_id))) {
    return res.status(400).json({ error: 'Invalid match ID. Must be a number.' });
  }
  if (!hero || !VALID_HERO_NAMES_SET.has(hero.trim())) {
    return res.status(400).json({ error: 'Invalid hero name.' });
  }

  try {
    // Fetch match from OpenDota
    const matchResp = await axios.get(`https://api.opendota.com/api/matches/${match_id}`, {
      timeout: 15000
    });
    const match = matchResp.data;

    if (!match || !match.players) {
      return res.status(404).json({ error: 'Match not found or not yet parsed by OpenDota.' });
    }

    const { heroes, abilities } = await getDotaConstants();
    const heroEntry = Object.values(heroes).find(h => h.localized_name === hero.trim());
    if (!heroEntry) {
      return res.status(400).json({ error: 'Hero not found in game data.' });
    }

    const player = match.players.find(p => p.hero_id === heroEntry.id);
    if (!player) {
      return res.status(404).json({ error: `${hero} did not play in match ${match_id}.` });
    }

    const isRadiant = player.player_slot < 128;
    const won = (isRadiant && match.radiant_win) || (!isRadiant && !match.radiant_win);
    const durationMin = Math.floor(match.duration / 60);
    const lane = LANE_NAMES[player.lane_role] || 'Unknown';

    const playerItems = await formatPlayerItems(player);

    // Build team summaries
    const buildTeamSummary = async (radiant) => {
      const teamPlayers = match.players.filter(p => (p.player_slot < 128) === radiant);
      const lines = [];
      for (const p of teamPlayers) {
        const h = Object.values(heroes).find(x => x.id === p.hero_id);
        const name = h?.localized_name || `Hero ${p.hero_id}`;
        lines.push(`${name}: ${p.kills}/${p.deaths}/${p.assists}, ${p.gold_per_min} GPM, ${p.last_hits} LH, ${p.hero_damage} hero dmg`);
      }
      return lines.join('\n');
    };

    const radiantSummary = await buildTeamSummary(true);
    const direSummary = await buildTeamSummary(false);

    // Skill build order (if available)
    let skillBuild = '';
    if (player.ability_upgrades_arr && player.ability_upgrades_arr.length) {
      const order = player.ability_upgrades_arr.slice(0, 18).map(abId => {
        const ab = Object.values(abilities).find(a => a.id === abId);
        return ab?.dname || `Ab${abId}`;
      });
      skillBuild = order.map((name, i) => `${i + 1}. ${name}`).join(' → ');
    }

    const prompt = `You are a Dota 2 coach reviewing a match. Be specific and constructive — point out real mistakes and concrete improvements.

**Match Result:** ${won ? 'WON' : 'LOST'} (${durationMin} min)
**Player:** ${hero} on ${isRadiant ? 'Radiant' : 'Dire'}, ${lane}

**Player Stats:**
- KDA: ${player.kills}/${player.deaths}/${player.assists}
- GPM/XPM: ${player.gold_per_min} / ${player.xp_per_min}
- Last Hits / Denies: ${player.last_hits} / ${player.denies}
- Net Worth: ${player.net_worth || player.total_gold || 'N/A'}
- Hero Damage: ${player.hero_damage}
- Tower Damage: ${player.tower_damage}
- Hero Healing: ${player.hero_healing}
- Level: ${player.level}
- Final Items: ${playerItems}
${skillBuild ? `- Skill Build Order: ${skillBuild}` : ''}

**Radiant Team:**
${radiantSummary}

**Dire Team:**
${direSummary}

**Respond with these sections:**

### Verdict
1-2 sentences on the overall performance.

### What Went Well
2-3 specific things the player did right (cite the stats).

### Key Mistakes
2-4 concrete mistakes or missed opportunities. Be specific — reference KDA, farm, items, or matchups.

### How to Improve
3-4 actionable tips for next time on ${hero} in this kind of matchup.

### Item & Skill Notes
Comment on whether their item build and skill order made sense for this game.

Be direct and helpful. No fluff.`;

    const groqResponse = await axios.post(GROQ_API_URL, {
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_completion_tokens: 4096,
      reasoning_effort: 'low'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      }
    });

    const choices = groqResponse.data.choices;
    if (choices && choices[0]?.message?.content) {
      return res.json({
        analysis: choices[0].message.content,
        match: { won, duration: durationMin, hero, lane, isRadiant }
      });
    }

    return res.status(500).json({ error: 'Failed to generate analysis.' });

  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Match not found on OpenDota.' });
    }
    console.error('Match analysis error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to analyze match. Try again in a moment.' });
  }
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

// API route to get tips from LLM
app.post('/api/get-tips', rateLimitMiddleware, async (req, res) => {
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
    const currentPatch = await getCurrentPatch();
    const yourHeroAbilities = await getHeroAbilitiesContext(yourHeroName);
    const roleItems = ROLE_ITEMS[yourHeroRole] || ROLE_ITEMS['Support'];
    const itemContext = await getItemContext(roleItems);

    // Get lane opponents for enemy abilities context
    let laneOpponents = [];
    if (yourHeroRole === 'Safe Lane' || yourHeroRole === 'Hard Support') {
        laneOpponents = [opponentOfflane, opponentSupport].filter(Boolean);
    } else if (yourHeroRole === 'Midlane') {
        laneOpponents = [opponentMidlane].filter(Boolean);
    } else if (yourHeroRole === 'Offlane' || yourHeroRole === 'Support') {
        laneOpponents = [opponentSafelane, opponentHardSupport].filter(Boolean);
    }
    const enemyAbilitiesContext = await getEnemyAbilitiesBrief(laneOpponents);

    // Get teammates for synergy context
    const teammates = myTeam.filter(p => p.hero !== yourHeroName).map(p => `${p.hero} (${p.role})`);

    // Format teams for the prompt
    const formatTeam = (team) => team.map(p => `${p.hero} (${p.role})`).join(', ');
    const myTeamFormatted = formatTeam(myTeam);
    const opponentTeamFormatted = formatTeam(opponentTeam);

    // Construct the *structured* prompt for the LLM
    const prompt = `You are a Dota 2 coach. Advise on playing **${yourHeroName}** as **${yourHeroRole}** (Patch ${currentPatch}).

**Teams:**
- Allies: ${myTeamFormatted}
- Enemies: ${opponentTeamFormatted}

**Your Abilities:**
${yourHeroAbilities}

**Lane Opponents' Key Abilities:**
${enemyAbilitiesContext || 'N/A'}

**Items Reference (${yourHeroRole}):**
${itemContext}

${laneMatchupInfo}

**Respond with these sections:**

### Overview
2-3 sentences on your win condition and role in this matchup.

### Laning Phase (0-10 min)
Starting items, how to trade with lane opponents, kill potential, and threats to avoid.

### Mid Game (10-25 min)
Core items timing, when to fight vs farm, positioning in teamfights.

### Late Game (25+ min)
Final items, teamfight role, key objectives (Roshan, high ground).

### Item Build
List starting → early → core → situational items. Explain key choices for this matchup.

### Teammate Synergies
How to combo with: ${teammates.join(', ')}. Mention 1-2 specific ability interactions.

### Enemy Threats
Key abilities to avoid and how to counter them.

Be specific to this matchup. No generic advice.`;

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

            // Increment rate limit only on successful response
            if (redis && req.rateLimitKey) {
              const count = await redis.incr(req.rateLimitKey);
              if (count === 1) await redis.expire(req.rateLimitKey, 86400);
              req.queriesRemaining = Math.max(0, FREE_TIER_LIMIT - count);
            }

            res.json({ tips, remaining: req.queriesRemaining, isPro: req.isPro });
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