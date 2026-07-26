// Server-rendered SEO pages: /heroes (hub), /heroes/:slug (guides),
// /counters/:slug (counter pages), plus /sitemap.xml and /robots.txt.
// Content comes from data/seo-content.json, produced by `npm run generate-seo`.

const SITE = 'https://www.dota2helper.com';

let content = { generatedAt: null, patch: '', heroes: {} };
try {
  content = require('./data/seo-content.json');
} catch (e) {
  console.warn('seo.js: data/seo-content.json not found — run `npm run generate-seo`. SEO pages will 404.');
}

const HEROES = content.heroes || {};
const SLUGS = Object.keys(HEROES).sort((a, b) => HEROES[a].name.localeCompare(HEROES[b].name));
const PATCH = content.patch || '';
const UPDATED = content.generatedAt ? new Date(content.generatedAt) : null;
const MONTH_YEAR = UPDATED
  ? UPDATED.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  : '';
const LASTMOD = UPDATED ? UPDATED.toISOString().slice(0, 10) : null;

// Meta rank by pub winrate (1 = highest winrate)
const RANKS = new Map(
  SLUGS.slice()
    .sort((a, b) => (HEROES[b].pubWinrate || 0) - (HEROES[a].pubWinrate || 0))
    .map((slug, i) => [slug, i + 1])
);

const ATTR_NAMES = { str: 'Strength', agi: 'Agility', int: 'Intelligence', all: 'Universal' };

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pct = (x) => (x * 100).toFixed(1) + '%';
const num = (x) => (x || 0).toLocaleString('en-US');

function layout({ title, description, canonical, jsonLd = [], body, noindex = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    ${noindex ? '<meta name="robots" content="noindex">' : ''}
    <link rel="canonical" href="${esc(canonical)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Dota 2 Helper">
    <meta property="og:image" content="${SITE}/images/dota2_logo.png">
    <meta name="twitter:card" content="summary">
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" type="image/png" href="/images/dota2_favicon.png">
    ${jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n    ')}
</head>
<body>
    <div class="container">
        <header class="app-header">
            <a href="/" class="site-brand" aria-label="Dota 2 Helper home">
                <img src="/images/dota2_logo.png" alt="Dota 2 Logo" class="header-logo">
                <span class="site-brand-text">helper</span>
            </a>
        </header>
        <nav class="feature-nav" aria-label="Site">
            <a href="/">AI Tips Tool</a>
            <a href="/heroes">Hero Guides</a>
            <a href="/#draftModeSection">Draft Mode</a>
        </nav>
        <main>
${body}
        </main>
        <footer>
            <p>
                <a href="/heroes">All hero guides</a>
                <span class="footer-separator">|</span>
                Suggestions or feedback? Reach out on <a href="https://x.com/ibnAmjid" target="_blank" rel="noopener noreferrer">X (formerly Twitter)</a>.
                <span class="footer-separator">|</span>
                View the source code on <a href="https://github.com/samiamjidkhan/dota2-helper" target="_blank" rel="noopener noreferrer">GitHub</a>.
            </p>
        </footer>
    </div>
    <script>
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    </script>
    <script defer src="/_vercel/insights/script.js"></script>
</body>
</html>`;
}

function breadcrumbs(items) {
  const links = items
    .map((it, i) => (i === items.length - 1
      ? `<span aria-current="page">${esc(it.name)}</span>`
      : `<a href="${esc(it.url)}">${esc(it.name)}</a>`))
    .join('<span class="crumb-sep">›</span>');
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${links}</nav>`;
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      ...(it.url ? { item: SITE + it.url } : {})
    }))
  };
}

function articleLd({ headline, description, canonical }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    dateModified: content.generatedAt,
    mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: 'Dota 2 Helper', url: SITE },
    publisher: { '@type': 'Organization', name: 'Dota 2 Helper', url: SITE }
  };
}

function matchupTable(rows, heroName, { theirPerspective = false } = {}) {
  const wrHeader = theirPerspective ? `Win rate vs ${esc(heroName)}` : `${esc(heroName)} win rate`;
  return `<div class="table-wrapper"><table>
<thead><tr><th>Hero</th><th>${wrHeader}</th><th>Games</th></tr></thead>
<tbody>${rows.map((m) => `
<tr><td><a href="/heroes/${m.slug}">${esc(m.name)}</a></td><td>${pct(theirPerspective ? 1 - m.winrate : m.winrate)}</td><td>${num(m.games)}</td></tr>`).join('')}
</tbody></table></div>`;
}

function ctaBox(text, buttonLabel, href) {
  return `<aside class="seo-cta">
    <p>${text}</p>
    <a class="seo-cta-btn" href="${href}">${esc(buttonLabel)}</a>
</aside>`;
}

function heroPage(h) {
  const canonical = `${SITE}/heroes/${h.slug}`;
  const title = `${h.name} Guide — Build, Tips & Matchups | Dota 2 ${PATCH}`;
  const description = `${h.name} guide for Dota 2 patch ${PATCH}: how to play, item build, best and worst matchups, common mistakes. Current win rate ${pct(h.pubWinrate)}. Updated ${MONTH_YEAR}.`;
  const crumbs = [
    { name: 'Home', url: '/' },
    { name: 'Hero Guides', url: '/heroes' },
    { name: h.name, url: `/heroes/${h.slug}` }
  ];
  const jsonLd = [breadcrumbLd(crumbs), articleLd({ headline: `${h.name} Guide — Dota 2 Patch ${PATCH}`, description, canonical })];
  if (h.faq && h.faq.length >= 2) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: h.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    });
  }

  const body = `
${breadcrumbs(crumbs)}
<article>
<h1>${esc(h.name)} Guide <span class="h1-sub">Dota 2 Patch ${esc(PATCH)}</span></h1>
<p class="page-meta">${esc((h.roles || []).join(' · '))} · ${esc(ATTR_NAMES[h.attr] || '')} · Updated ${esc(MONTH_YEAR)}</p>
<div class="stat-chips">
    <div class="stat-chip"><span class="stat-value">${pct(h.pubWinrate)}</span><span class="stat-label">Win rate</span></div>
    <div class="stat-chip"><span class="stat-value">#${RANKS.get(h.slug)}</span><span class="stat-label">of ${SLUGS.length} by win rate</span></div>
    <div class="stat-chip"><span class="stat-value">${num(h.pubPicks)}</span><span class="stat-label">matches analyzed</span></div>
    <a class="stat-chip stat-chip-link" href="/counters/${h.slug}"><span class="stat-value">Counters</span><span class="stat-label">who beats ${esc(h.name)} →</span></a>
</div>
<div class="output-content seo-article">
${h.guideHtml}
</div>
<section class="matchups">
    <h2>${esc(h.name)} Matchups (Patch ${esc(PATCH)})</h2>
    <div class="matchup-grid">
        <div>
            <h3>Toughest matchups</h3>
            ${matchupTable(h.counters.slice(0, 8), h.name)}
        </div>
        <div>
            <h3>Easiest matchups</h3>
            ${matchupTable(h.bestVs.slice(0, 8), h.name)}
        </div>
    </div>
    <p>Struggling in a specific game? See the full <a href="/counters/${h.slug}">${esc(h.name)} counters breakdown</a>.</p>
</section>
${ctaBox(`Playing ${esc(h.name)} right now? Get AI tips tailored to your exact draft — your hero, allies and enemies.`, 'Get tips for my draft — free', '/')}
</article>`;

  return layout({ title, description, canonical, jsonLd, body });
}

function counterPage(h) {
  const canonical = `${SITE}/counters/${h.slug}`;
  const top3 = h.counters.slice(0, 3).map((c) => c.name).join(', ');
  const totalGames = h.counters.reduce((s, c) => s + c.games, 0);
  const title = `Best ${h.name} Counters — Dota 2 Patch ${PATCH}`;
  const description = `The best counters to ${h.name} in Dota 2 patch ${PATCH}, from ${num(totalGames)} recent ranked matches: ${top3}. Plus drafting, laning and item tips against ${h.name}.`;
  const crumbs = [
    { name: 'Home', url: '/' },
    { name: 'Hero Guides', url: '/heroes' },
    { name: h.name, url: `/heroes/${h.slug}` },
    { name: 'Counters', url: `/counters/${h.slug}` }
  ];
  const jsonLd = [breadcrumbLd(crumbs), articleLd({ headline: `Best ${h.name} Counters — Dota 2 Patch ${PATCH}`, description, canonical })];

  const body = `
${breadcrumbs(crumbs)}
<article>
<h1>Best ${esc(h.name)} Counters <span class="h1-sub">Dota 2 Patch ${esc(PATCH)}</span></h1>
<p class="page-meta">Based on ${num(totalGames)} recent ranked matches · Updated ${esc(MONTH_YEAR)} · Also see the <a href="/heroes/${h.slug}">${esc(h.name)} guide</a></p>
<section>
    <h2>Heroes that beat ${esc(h.name)}</h2>
    ${matchupTable(h.counters.slice(0, 10), h.name, { theirPerspective: true })}
</section>
<div class="output-content seo-article">
${h.counterHtml}
</div>
<section>
    <h2>Don't pick these against ${esc(h.name)}</h2>
    <p>${esc(h.name)} wins these matchups most often — avoid them in draft:</p>
    ${matchupTable(h.bestVs.slice(0, 6), h.name)}
</section>
${ctaBox(`In champion select against ${esc(h.name)}? Draft Mode gives you live counter-pick suggestions for your role.`, 'Open Draft Mode — free', '/#draftModeSection')}
</article>`;

  return layout({ title, description, canonical, jsonLd, body });
}

function hubPage() {
  const canonical = `${SITE}/heroes`;
  const title = `Dota 2 Hero Guides & Counters — All ${SLUGS.length} Heroes (Patch ${PATCH})`;
  const description = `Up-to-date Dota 2 guides and counter picks for all ${SLUGS.length} heroes on patch ${PATCH}: builds, matchup data from recent ranked games, and AI-assisted tips. Updated ${MONTH_YEAR}.`;
  const crumbs = [{ name: 'Home', url: '/' }, { name: 'Hero Guides', url: '/heroes' }];

  const byAttr = { str: [], agi: [], int: [], all: [] };
  for (const slug of SLUGS) {
    const h = HEROES[slug];
    (byAttr[h.attr] || byAttr.all).push(h);
  }

  const sections = Object.entries(byAttr)
    .filter(([, list]) => list.length)
    .map(([attr, list]) => `
<section class="hero-index-section">
    <h2>${ATTR_NAMES[attr]} Heroes</h2>
    <ul class="hero-index-grid">
        ${list.map((h) => `<li><a href="/heroes/${h.slug}">${esc(h.name)}</a><a class="counters-mini-link" href="/counters/${h.slug}">counters</a></li>`).join('\n        ')}
    </ul>
</section>`).join('\n');

  const body = `
${breadcrumbs(crumbs)}
<h1>Dota 2 Hero Guides &amp; Counters <span class="h1-sub">Patch ${esc(PATCH)}</span></h1>
<p class="page-meta">Guides for all ${SLUGS.length} heroes, built on win-rate and matchup data from recent ranked matches. Updated ${esc(MONTH_YEAR)}.</p>
${ctaBox('Want advice for a specific draft instead? The AI tool analyzes your exact five-vs-five.', 'Get tips for my draft — free', '/')}
${sections}`;

  return layout({ title, description, canonical, jsonLd: [breadcrumbLd(crumbs)], body });
}

function notFoundPage(res) {
  res.status(404).send(layout({
    title: 'Page Not Found | Dota 2 Helper',
    description: 'This page does not exist.',
    canonical: `${SITE}/heroes`,
    noindex: true,
    body: `
<h1>Page not found</h1>
<p class="page-meta">That page doesn't exist. Try the <a href="/heroes">hero guides index</a> or the <a href="/">AI draft tool</a>.</p>`
  }));
}

const CACHE_HEADER = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';

module.exports = function mountSeoPages(app) {
  const withCache = (res) => res.set('Cache-Control', CACHE_HEADER).type('html');

  app.get('/heroes', (req, res) => {
    if (!SLUGS.length) return notFoundPage(res);
    withCache(res).send(hubPage());
  });

  app.get('/heroes/:slug', (req, res) => {
    const h = HEROES[String(req.params.slug).toLowerCase()];
    if (!h) return notFoundPage(res);
    withCache(res).send(heroPage(h));
  });

  app.get('/counters/:slug', (req, res) => {
    const h = HEROES[String(req.params.slug).toLowerCase()];
    if (!h) return notFoundPage(res);
    withCache(res).send(counterPage(h));
  });

  app.get('/sitemap.xml', (req, res) => {
    const urls = [
      { loc: `${SITE}/`, priority: '1.0' },
      { loc: `${SITE}/heroes`, priority: '0.9' },
      ...SLUGS.flatMap((slug) => [
        { loc: `${SITE}/heroes/${slug}`, priority: '0.8' },
        { loc: `${SITE}/counters/${slug}`, priority: '0.7' }
      ])
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u.loc}</loc>${LASTMOD ? `<lastmod>${LASTMOD}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
    res.set('Cache-Control', CACHE_HEADER).type('application/xml').send(xml);
  });

  app.get('/robots.txt', (req, res) => {
    res.set('Cache-Control', CACHE_HEADER).type('text/plain').send(
`User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`);
  });

  // Proper 404 for anything that reaches the function and matches nothing above.
  // (vercel.json routes unknown paths here instead of soft-200ing the homepage.)
  app.use((req, res) => notFoundPage(res));
};
