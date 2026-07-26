#!/usr/bin/env node
// Generates the static SEO content bundle used by seo.js to render
// /heroes/:slug and /counters/:slug pages.
//
// Phase 1: snapshot OpenDota hero stats + per-hero matchups -> data/opendota-snapshot.json
// Phase 2: generate guide + counters copy per hero via Groq  -> data/seo-content.json
//
// Usage:
//   node scripts/generate-seo-content.js                   full run (resumable: skips heroes already done)
//   node scripts/generate-seo-content.js --limit 3         only first N heroes (testing)
//   node scripts/generate-seo-content.js --snapshot-only   refresh OpenDota data, skip LLM phase
//   node scripts/generate-seo-content.js --refresh-snapshot  refetch OpenDota data even if snapshot exists
//   node scripts/generate-seo-content.js --force           regenerate content even for heroes already done
//
// Re-run monthly (and after big patches) to keep pages fresh, then redeploy.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { marked } = require('marked');
const { DOTA_HERO_NAMES, DOTACONSTANTS_ALIASES, heroSlug } = require('../lib/heroes');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'opendota-snapshot.json');
const CONTENT_FILE = path.join(DATA_DIR, 'seo-content.json');

const OPENDOTA_DELAY_MS = 1100; // free tier: 60 calls/min
const LLM_CONCURRENCY = 3;
const MIN_MATCHUP_GAMES = 50;

const args = process.argv.slice(2);
const FLAGS = {
  limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity,
  snapshotOnly: args.includes('--snapshot-only'),
  refreshSnapshot: args.includes('--refresh-snapshot'),
  force: args.includes('--force')
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if (i === tries - 1) throw err;
      const wait = status === 429 ? 15000 : 2000 * (i + 1);
      console.warn(`  retry ${i + 1} for ${url} (${status || err.message}), waiting ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function groqWithRetry(prompt, { temperature = 0.6, maxTokens = 3500 } = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.post(GROQ_API_URL, {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_completion_tokens: maxTokens,
        reasoning_effort: 'low'
      }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        timeout: 90000
      });
      const content = res.data.choices?.[0]?.message?.content;
      if (content && content.length > 400) return content;
      throw new Error('LLM returned empty/too-short content');
    } catch (err) {
      if (i === tries - 1) throw err;
      const status = err.response?.status;
      const wait = status === 429 ? 20000 : 4000 * (i + 1);
      console.warn(`  groq retry ${i + 1} (${status || err.message}), waiting ${wait}ms`);
      await sleep(wait);
    }
  }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

// ---------- Roster (dotaconstants) ----------

async function buildRoster() {
  const dc = await import('dotaconstants');
  const byLocalizedName = new Map(Object.values(dc.heroes).map((h) => [h.localized_name, h]));
  const roster = [];
  for (const name of DOTA_HERO_NAMES) {
    const dcName = DOTACONSTANTS_ALIASES[name] || name;
    const hero = byLocalizedName.get(dcName);
    if (!hero) {
      console.error(`!! No dotaconstants entry for "${name}" (looked up "${dcName}") — skipping`);
      continue;
    }
    roster.push({
      name, // site-facing name
      slug: heroSlug(name),
      id: hero.id,
      tag: hero.name, // npc_dota_hero_*
      attr: hero.primary_attr,
      roles: hero.roles || [],
      attackType: hero.attack_type
    });
  }
  const slugs = new Set(roster.map((r) => r.slug));
  if (slugs.size !== roster.length) throw new Error('Slug collision detected in roster');
  const patch = dc.patch[dc.patch.length - 1]?.name || 'current';
  return { roster, dc, patch };
}

// Compact ability + facet context for prompts (adapted from server.js getHeroAbilitiesContext)
function abilityContext(dc, tag) {
  const heroAbilities = dc.hero_abilities[tag];
  if (!heroAbilities) return '';
  const lines = heroAbilities.abilities
    .map((n) => dc.abilities[n])
    .filter((a) => a && a.dname && a.desc)
    .slice(0, 8)
    .map((a) => `- **${a.dname}**: ${String(a.desc).slice(0, 220)}`);
  const facets = (heroAbilities.facets || [])
    .filter((f) => f.title && f.description && !f.deprecated)
    .map((f) => `- Facet "${f.title}": ${String(f.description).slice(0, 160)}`);
  return lines.join('\n') + (facets.length ? `\nFacets:\n${facets.join('\n')}` : '');
}

// ---------- Phase 1: OpenDota snapshot ----------

async function buildSnapshot(roster, patch) {
  if (!FLAGS.refreshSnapshot && fs.existsSync(SNAPSHOT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    const haveAll = roster.every((h) => existing.heroes?.[h.slug]);
    if (haveAll && existing.patch === patch) {
      console.log(`Snapshot exists (${existing.fetchedAt}, patch ${existing.patch}) — reusing. Use --refresh-snapshot to refetch.`);
      return existing;
    }
  }

  console.log('Fetching OpenDota heroStats...');
  const heroStats = await getWithRetry('https://api.opendota.com/api/heroStats');
  const statsById = new Map(heroStats.map((h) => [h.id, h]));
  const idToRoster = new Map(roster.map((h) => [h.id, h]));

  const snapshot = { fetchedAt: new Date().toISOString(), patch, heroes: {} };

  // Pub winrate across all ranked brackets (1=Herald ... 8=Immortal)
  const pubStats = (s) => {
    let picks = 0, wins = 0;
    for (let b = 1; b <= 8; b++) {
      picks += s[`${b}_pick`] || 0;
      wins += s[`${b}_win`] || 0;
    }
    return { picks, winrate: picks ? wins / picks : null };
  };

  console.log(`Fetching matchups for ${roster.length} heroes (~${Math.ceil(roster.length * OPENDOTA_DELAY_MS / 60000)} min)...`);
  for (let i = 0; i < roster.length; i++) {
    const hero = roster[i];
    const s = statsById.get(hero.id) || {};
    const pub = pubStats(s);

    const matchups = await getWithRetry(`https://api.opendota.com/api/heroes/${hero.id}/matchups`);
    let qualified = matchups.filter((m) => m.games_played >= MIN_MATCHUP_GAMES && idToRoster.has(m.hero_id));
    if (qualified.length < 20) {
      qualified = matchups.filter((m) => m.games_played >= 20 && idToRoster.has(m.hero_id));
    }
    const enriched = qualified.map((m) => {
      const opp = idToRoster.get(m.hero_id);
      return {
        name: opp.name,
        slug: opp.slug,
        winrate: m.wins / m.games_played, // HERO's winrate vs this opponent
        games: m.games_played
      };
    });
    enriched.sort((a, b) => a.winrate - b.winrate);
    const counters = enriched.slice(0, 10); // hero struggles vs these
    const bestVs = enriched.slice(-10).reverse(); // hero stomps these

    snapshot.heroes[hero.slug] = {
      id: hero.id, name: hero.name, slug: hero.slug,
      attr: hero.attr, roles: hero.roles, attackType: hero.attackType,
      pubWinrate: pub.winrate, pubPicks: pub.picks,
      proPicks: s.pro_pick || 0, proWins: s.pro_win || 0,
      counters, bestVs
    };
    if ((i + 1) % 10 === 0 || i === roster.length - 1) {
      console.log(`  matchups: ${i + 1}/${roster.length}`);
      writeJsonAtomic(SNAPSHOT_FILE, snapshot);
    }
    await sleep(OPENDOTA_DELAY_MS);
  }

  writeJsonAtomic(SNAPSHOT_FILE, snapshot);
  console.log(`Snapshot written to ${SNAPSHOT_FILE}`);
  return snapshot;
}

// ---------- Phase 2: LLM content ----------

const pct = (x) => (x * 100).toFixed(1) + '%';

function guidePrompt(h, snap, patch, abilities, monthYear) {
  const counters = snap.counters.slice(0, 6).map((c) => `${c.name} (${h.name} wins only ${pct(c.winrate)} of ${c.games} games)`).join('; ');
  const bestVs = snap.bestVs.slice(0, 6).map((c) => `${c.name} (${h.name} wins ${pct(c.winrate)} of ${c.games} games)`).join('; ');
  return `You are an expert Dota 2 coach writing a hero guide for **${h.name}** on patch ${patch}.

CURRENT DATA (OpenDota, ${monthYear} — cite these numbers where relevant):
- Pub win rate: ${pct(snap.pubWinrate)} across ${snap.pubPicks.toLocaleString()} recent ranked matches
- Typical roles: ${snap.roles.join(', ')}
- Toughest matchups right now: ${counters}
- Easiest matchups right now: ${bestVs}

ABILITIES (patch ${patch}):
${abilities}

Write clean markdown with EXACTLY this structure (no H1, start directly with the intro paragraph):

An intro of 2-3 sentences: who ${h.name} is, their role identity, and where they stand in the current meta (reference the win rate).

## How to Play ${h.name}
### Laning Phase
4-5 bullet points specific to ${h.name}'s abilities and typical lane opponents.
### Mid Game
3-4 bullets: power spikes, what to do on the map, when to fight.
### Late Game
2-3 bullets: win conditions, positioning, what loses the game.

## Item Build
### Starting Items
### Core Items
### Situational Items
Bullets in the form "**Item Name** — one line on why/when". Be specific to ${h.name} on this patch.

## Common Mistakes
3-4 bullets on what low-MMR ${h.name} players get wrong.

## FAQ
Exactly 3 questions as ### headings, phrased the way a player would search Google (e.g. "Is ${h.name} good in the current patch?", "What lane does ${h.name} play?", "Who counters ${h.name}?"). Each answer 2-3 sentences using the data above.

Rules: be concrete and mechanical (name abilities and items), never write filler like "In conclusion", do not invent statistics beyond the data provided, no HTML tags.`;
}

function counterPrompt(h, snap, patch, abilities) {
  const counters = snap.counters.slice(0, 8).map((c, i) => `${i + 1}. ${c.name} — ${h.name} wins only ${pct(c.winrate)} of ${c.games} games against them`).join('\n');
  const bestVs = snap.bestVs.slice(0, 5).map((c) => c.name).join(', ');
  return `You are an expert Dota 2 analyst writing the "${h.name} counters" page for patch ${patch}.

DATA (OpenDota, recent ranked matches):
- ${h.name} overall pub win rate: ${pct(snap.pubWinrate)}
- Heroes that beat ${h.name} (his worst matchups, strongest counter first):
${counters}
- For contrast, ${h.name} stomps: ${bestVs}

${h.name.toUpperCase()}'S ABILITIES:
${abilities}

Write clean markdown with EXACTLY this structure (no H1, start directly with the intro paragraph):

An intro of 2-3 sentences: what makes ${h.name} threatening and the core principle behind shutting ${h.name} down.

## Why These Heroes Beat ${h.name}
For each of the TOP 5 counters from the data, a ### heading with the hero's name, then 2-3 sentences: the mechanical reason it wins (specific ability interactions) plus one practical tip.

## Drafting Against ${h.name}
3-4 bullets: what ability types and hero categories to prioritize when banning/picking.

## Laning Against ${h.name}
3-4 bullets: how to trade, when ${h.name} is weakest, what to punish.

## Itemizing Against ${h.name}
3-4 bullets in the form "**Item Name** — why it works against ${h.name}".

Rules: be concrete and mechanical, no filler, do not invent statistics beyond the data provided, no HTML tags.`;
}

function cleanMarkdown(md) {
  return md
    .replace(/<[^>]*>/g, '') // strip any raw HTML the model emitted
    .replace(/^#\s+/gm, '## ') // no H1s in the body
    .trim();
}

function parseFaq(md) {
  const faqSection = md.split(/^## FAQ\s*$/m)[1];
  if (!faqSection) return [];
  const parts = faqSection.split(/^###\s+/m).slice(1);
  const plain = (s) => s.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return parts.map((p) => {
    const lines = p.trim().split('\n');
    const q = plain(lines[0]).replace(/\?*$/, '?');
    const a = plain(lines.slice(1).join(' '));
    return { q, a };
  }).filter((f) => f.q.length > 5 && f.a.length > 20);
}

function firstParagraphText(md) {
  const para = md.split(/\n\s*\n/)[0] || '';
  return para.replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();
}

async function generateHero(hero, snap, patch, dc, monthYear) {
  const abilities = abilityContext(dc, hero.tag);
  const [guideMd, counterMd] = await Promise.all([
    groqWithRetry(guidePrompt(hero, snap, patch, abilities, monthYear)),
    groqWithRetry(counterPrompt(hero, snap, patch, abilities))
  ]);

  const cleanGuide = cleanMarkdown(guideMd);
  const cleanCounter = cleanMarkdown(counterMd);
  if ((cleanGuide.match(/^## /gm) || []).length < 3) throw new Error('guide missing sections');
  if ((cleanCounter.match(/^## /gm) || []).length < 3) throw new Error('counters missing sections');

  return {
    name: hero.name,
    slug: hero.slug,
    id: hero.id,
    attr: snap.attr,
    roles: snap.roles,
    pubWinrate: snap.pubWinrate,
    pubPicks: snap.pubPicks,
    counters: snap.counters,
    bestVs: snap.bestVs,
    guideHtml: marked.parse(cleanGuide),
    counterHtml: marked.parse(cleanCounter),
    guideIntro: firstParagraphText(cleanGuide),
    counterIntro: firstParagraphText(cleanCounter),
    faq: parseFaq(cleanGuide)
  };
}

async function main() {
  if (!GROQ_API_KEY && !FLAGS.snapshotOnly) {
    console.error('GROQ_API_KEY missing from .env');
    process.exit(1);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const { roster, dc, patch } = await buildRoster();
  console.log(`Roster: ${roster.length} heroes, patch ${patch}`);

  const snapshot = await buildSnapshot(roster, patch);
  if (FLAGS.snapshotOnly) return;

  const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  let content = { generatedAt: new Date().toISOString(), patch, heroes: {} };
  if (fs.existsSync(CONTENT_FILE) && !FLAGS.force) {
    const existing = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
    if (existing.patch === patch) content = existing;
  }

  const todo = roster
    .filter((h) => snapshot.heroes[h.slug])
    .filter((h) => FLAGS.force || !content.heroes[h.slug])
    .slice(0, FLAGS.limit);
  console.log(`Generating content for ${todo.length} heroes (${Object.keys(content.heroes).length} already done)...`);

  let done = 0, failed = [];
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const hero = queue.shift();
      try {
        const entry = await generateHero(hero, snapshot.heroes[hero.slug], patch, dc, monthYear);
        content.heroes[hero.slug] = entry;
        content.generatedAt = new Date().toISOString();
        writeJsonAtomic(CONTENT_FILE, content);
        done++;
        console.log(`  [${done}/${todo.length}] ${hero.name} ok`);
      } catch (err) {
        failed.push(hero.name);
        console.error(`  !! ${hero.name} FAILED: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: LLM_CONCURRENCY }, worker));

  console.log(`\nDone. ${done} generated, ${failed.length} failed, total in bundle: ${Object.keys(content.heroes).length}`);
  if (failed.length) console.log('Failed (re-run the script to retry just these):', failed.join(', '));
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
