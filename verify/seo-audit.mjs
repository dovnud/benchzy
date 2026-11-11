// Benchzy milestone-5 SEO/GEO audit. Static checks over dist/ (run
// after `npm run build`): sitemap coverage and parse, exactly one
// canonical per page pointing at itself, OG cards present, robots.txt
// welcoming the AI crawlers by name, llms.txt present, every JSON-LD
// block parsing, HowTo present on every tool page, the internal-link
// graph (orphans and click depth from home), the promise page's
// computed score matching an independent recount from src/, and the
// "biggest" guard (the word may appear only on /what-free-means/).
// Writes verify/seo-audit.json; exits 1 on any hard failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const SRC_PAGES = path.join(ROOT, 'src', 'pages');
const SITE = 'https://benchzy.com';

const out = { failures: [], warnings: [] };
const fail = (m) => { out.failures.push(m); console.log('FAIL', m); };
const warn = (m) => { out.warnings.push(m); console.log('WARN', m); };

// --- enumerate dist pages ---
function walk(dir, base = '') {
  const routes = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routes.push(...walk(p, base + '/' + e.name));
    else if (e.name === 'index.html') routes.push(base === '' ? '/' : base + '/');
  }
  return routes;
}
const distRoutes = walk(DIST).sort();
out.distPages = distRoutes;
console.log('dist pages:', distRoutes.length);

// Short language URLs (milestone 8 as meta-refresh stub pages;
// milestone 18 as TRUE redirects): the stubs were one-sentence pages,
// and Cloudflare Pages serves an existing static file in preference
// to a _redirects rule, so milestone 18 deleted the stubs and the
// short URLs are now 301 rules in dist/_redirects. What this audit
// asserts is the same as ever: the short URLs land on the real
// localized tool pages and stay out of the sitemap; the mechanism
// check below matches the mechanism that actually ships.
const REDIRECTS = {
  '/es/quitar-fondo/': '/es/quitar-fondo-de-imagen-gratis/',
  '/pt/remover-fundo/': '/pt-br/remover-fundo-de-imagem-gratis/',
};
const contentRoutes = distRoutes.filter((r) => !(r in REDIRECTS));
out.redirectPages = Object.keys(REDIRECTS);

const html = {};
for (const r of distRoutes) {
  html[r] = fs.readFileSync(path.join(DIST, r === '/' ? 'index.html' : r.slice(1) + 'index.html'), 'utf8');
}

// --- sitemap ---
const smPath = path.join(DIST, 'sitemap.xml');
if (!fs.existsSync(smPath)) fail('dist/sitemap.xml missing');
else {
  const sm = fs.readFileSync(smPath, 'utf8');
  if (!sm.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail('sitemap: bad XML prolog');
  if (!sm.trimEnd().endsWith('</urlset>')) fail('sitemap: does not close with </urlset>');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urlCount = (sm.match(/<url>/g) || []).length;
  if (urlCount !== locs.length) fail(`sitemap: ${urlCount} <url> vs ${locs.length} <loc>`);
  out.sitemapCount = locs.length;
  const expected = contentRoutes.map((r) => SITE + r).sort();
  const got = [...locs].sort();
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail('sitemap URL set != dist page set');
    out.sitemapMissing = expected.filter((u) => !got.includes(u));
    out.sitemapExtra = got.filter((u) => !expected.includes(u));
  }
  const hreflangCount = (sm.match(/<xhtml:link /g) || []).length;
  out.sitemapHreflangLinks = hreflangCount;
  // Milestone 8: 4 clusters (2 background-removal + the promise page
  // and the proof page, translated in milestone 8) x 4 links x 3 pages.
  if (hreflangCount !== 48) fail(`sitemap: expected 48 hreflang links (4 clusters x 4 x 3 pages), got ${hreflangCount}`);
  for (const r of Object.keys(REDIRECTS)) {
    if (locs.includes(SITE + r)) fail(`sitemap: redirect page ${r} must not be listed`);
  }
  console.log('sitemap: locs', locs.length, 'hreflang links', hreflangCount);
}

// --- per-page head checks ---
const ldTypes = {};
for (const r of contentRoutes) {
  const h = html[r];
  const canonicals = [...h.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  if (canonicals.length !== 1) fail(`${r}: ${canonicals.length} canonical tags`);
  else if (canonicals[0] !== SITE + r) fail(`${r}: canonical ${canonicals[0]} != ${SITE + r}`);
  for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!h.includes(`property="${prop}"`)) fail(`${r}: missing ${prop}`);
  }
  if (!h.includes('name="twitter:card"')) fail(`${r}: missing twitter:card`);
  // Milestone 8: the privacy page is footer-linked on every page.
  if (!h.includes('href="/privacy/"')) fail(`${r}: footer privacy link missing`);
  // Milestone 8: the aggregate-logs sentence is killed site-wide.
  if (h.includes('may be kept in aggregate')) fail(`${r}: still carries the killed aggregate sentence`);
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ldTypes[r] = [];
  for (const b of blocks) {
    try {
      const j = JSON.parse(b);
      ldTypes[r].push(j['@type']);
    } catch (e) {
      fail(`${r}: JSON-LD does not parse: ${e.message}`);
    }
  }
}
out.ldTypes = ldTypes;
if (!fs.existsSync(path.join(DIST, 'og.png'))) fail('dist/og.png missing');

// --- HowTo coverage on tool pages (recomputed from src) ---
function srcFiles(dir, base = '') {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) files.push(...srcFiles(path.join(dir, e.name), base + e.name + '/'));
    else if (e.name.endsWith('.astro')) files.push(base + e.name);
  }
  return files;
}
const TOOL_ENGINES = ['remove-bg', 'compress-pdf', 'compress-image', 'merge-pdf', 'split-pdf', 'ocr-pdf', 'ocr-image', 'size-checker', 'sign-pdf', 'flatten-pdf', 'protect-pdf', 'unlock-pdf', 'resize-image', 'rotate-pdf', 'pdf-page-numbers', 'watermark-pdf', 'extract-images-pdf', 'organize-pdf', 'pdf-metadata', 'jpg-to-pdf', 'pdf-to-jpg', 'heic-to-jpg'];
// Runner scripts (milestone 6): tool pages that run the engines above
// (batch doors, interleave, workflow chains); tool pages, not new tools.
// Mirrors the counting in src/pages/what-free-means.astro exactly.
const PAGE_SCRIPTS = ['batch-pdf', 'batch-image', 'batch-remove-bg', 'workflows', 'interleave-pdf', 'convert-image'];
// Milestone 22: 404.astro is a utility page (the not-found page),
// excluded from the page recount exactly as what-free-means.astro
// excludes it from the counts it prints; the two must stay in step.
const srcList = srcFiles(SRC_PAGES).filter((f) => f !== '404.astro');
const enginesUsed = new Set();
const toolRoutes = [];
for (const f of srcList) {
  const src = fs.readFileSync(path.join(SRC_PAGES, f), 'utf8');
  const found = TOOL_ENGINES.filter((e) => src.includes(`scripts/${e}.js`));
  const runner = PAGE_SCRIPTS.some((e) => src.includes(`scripts/${e}.js`));
  if (found.length || runner) {
    found.forEach((e) => enginesUsed.add(e));
    let route = '/' + f.replace(/\.astro$/, '');
    if (route.endsWith('/index')) route = route.slice(0, -'index'.length);
    else if (route !== '/') route += '/';
    // (Milestone 7: the homepage became a tool page when the flagship
    // moved into its hero; the old derivation turned its route into
    // '//' and the schema lookup missed the JSON-LD that is verifiably
    // in dist/index.html. The requirement itself is unchanged.)
    toolRoutes.push(route);
  }
}
out.recount = { pages: srcList.length, toolPages: toolRoutes.length, tools: enginesUsed.size };
for (const r of toolRoutes) {
  if (!(ldTypes[r] || []).includes('HowTo')) fail(`${r}: tool page without HowTo schema`);
  if (!(ldTypes[r] || []).includes('FAQPage')) fail(`${r}: tool page without FAQPage schema`);
}
console.log('tool pages with HowTo:', toolRoutes.length);

// --- robots + llms ---
const robots = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
if (!robots) fail('dist/robots.txt missing');
else {
  for (const bot of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
    'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Meta-ExternalAgent']) {
    if (!robots.includes(`User-agent: ${bot}`)) fail(`robots.txt: ${bot} not named`);
  }
  if (!robots.includes('Sitemap: https://benchzy.com/sitemap.xml')) fail('robots.txt: sitemap line missing');
  if (/Disallow:\s*\//.test(robots)) fail('robots.txt: something is disallowed');
}
if (!fs.existsSync(path.join(DIST, 'llms.txt'))) fail('dist/llms.txt missing');

// --- internal link graph: orphans + depth ---
const inbound = new Map(contentRoutes.map((r) => [r, new Set()]));
const edges = new Map();
for (const r of contentRoutes) {
  const targets = new Set();
  for (const m of html[r].matchAll(/href="(\/[^"#]*)"/g)) {
    let t = m[1];
    if (t.startsWith('//')) continue;
    if (!t.endsWith('/')) t += '/';
    if (t === r) continue;
    if (inbound.has(t)) { targets.add(t); inbound.get(t).add(r); }
  }
  edges.set(r, targets);
}
const orphans = contentRoutes.filter((r) => r !== '/' && inbound.get(r).size === 0);
out.orphans = orphans;
if (orphans.length) fail('orphan pages: ' + orphans.join(', '));
const depth = { '/': 0 };
const queue = ['/'];
while (queue.length) {
  const cur = queue.shift();
  for (const t of edges.get(cur) || []) {
    if (depth[t] === undefined) { depth[t] = depth[cur] + 1; queue.push(t); }
  }
}
out.depth = depth;
const deep = Object.entries(depth).filter(([, d]) => d > 3);
if (deep.length) fail('pages deeper than 3 clicks: ' + deep.map(([r, d]) => `${r} (${d})`).join(', '));
const unreached = contentRoutes.filter((r) => depth[r] === undefined);
if (unreached.length) fail('pages unreachable from home: ' + unreached.join(', '));
console.log('depths:', JSON.stringify(depth));

// --- promise page score matches the recount ---
const wfm = html['/what-free-means/'] || '';
for (const [label, n] of [['working tools', out.recount.tools], ['tool pages', out.recount.toolPages], ['pages in all', out.recount.pages]]) {
  const re = new RegExp(`${label}</dt><dd>(\\d+)</dd>`);
  const m = wfm.match(re);
  if (!m) fail(`what-free-means: score row "${label}" not found`);
  else if (Number(m[1]) !== n) fail(`what-free-means: ${label} shows ${m[1]}, recount says ${n}`);
}
if (!wfm.includes('Our promise: every file job in one place.')) fail('what-free-means: promise line missing');

// --- "biggest" guard: as a claim about Benchzy, the word lives only on
// the commitments page, as an aim. Reviewed exceptions are references to
// rivals or to a file's contents, which are not claims about Benchzy:
// "the biggest converter / PDF site / site" = the measured incumbents of
// NUMBERS.md; "the biggest one" = the biggest photo inside a PDF, in the
// compress pages' own how-it-works text. Any other use fails the audit.
const BIGGEST_ALLOWED = [/the biggest converter/gi, /the biggest PDF site/gi, /the biggest site/gi, /the biggest one/gi];
for (const r of contentRoutes) {
  if (r === '/what-free-means/') continue;
  let rest = html[r];
  for (const re of BIGGEST_ALLOWED) rest = rest.replace(re, '');
  if (/biggest/i.test(rest)) fail(`${r}: contains "biggest" outside the commitments page (not a reviewed rival reference)`);
  if (/most tools/i.test(html[r])) fail(`${r}: contains "most tools" outside the commitments page`);
}

// --- redirects: true 301 rules in _redirects, no stub shadowing ---
const redirectsFile = fs.existsSync(path.join(DIST, '_redirects'))
  ? fs.readFileSync(path.join(DIST, '_redirects'), 'utf8') : '';
for (const [r, target] of Object.entries(REDIRECTS)) {
  if (!redirectsFile.includes(`${r} ${target} 301`)) fail(`redirect ${r}: no 301 rule to ${target} in dist/_redirects`);
  if (distRoutes.includes(r)) fail(`redirect ${r}: a stub page still exists in dist and would shadow the rule`);
}

fs.writeFileSync(path.join(HERE, 'seo-audit.json'), JSON.stringify(out, null, 2));
console.log(out.failures.length ? `SEO AUDIT: ${out.failures.length} FAILURES` : 'SEO AUDIT: ALL CHECKS PASSED', `(${out.warnings.length} warnings)`);
process.exit(out.failures.length ? 1 : 0);
