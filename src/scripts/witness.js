// Check It Yourself: the network witness.
// Honesty contract: this page claims only what it shows.
//  - It lists, live, every resource this page loads (the browser's own
//    Performance timeline) and every fetch/XMLHttpRequest the page's code
//    makes (a watcher installed by this script before any job can run).
//  - The witnessed job below (read a file, fingerprint it, describe it)
//    runs entirely in page memory. The page counts any network request
//    that happens while the job runs and prints the count.
//  - Since milestone 19 the site carries a visit counter (Google
//    Analytics). Its requests are part of what the page loads, so the
//    witness lists them like everything else and labels them "visit
//    counter", and its verdict counts them separately: the claim the
//    page grades is that a job sends nothing, not that a page load is
//    invisible. The counter fires when a page opens; a job run sends
//    it nothing.
//  - Since milestone 23 the site also carries the ad network's
//    loader (Google AdSense, named on the privacy page). It gets
//    exactly the counter's treatment: its requests are part of what
//    the page loads, so the witness lists them, labels them "ad
//    loader", and counts them in their own bucket. The loader
//    arrives when a page opens; a job run calls nothing new.
//  - Nothing here asks you to trust the page: the manual network-panel
//    steps on the page show the same thing with the browser's own tools.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, wireTray } from './workbench.js';

// Witness strings per page language (milestone 8: the ES and PT
// check-it-yourself pages run this same witness). ES/PT strings are
// in-house drafts, pending human review (TRANSLATIONS.md).
const W_SETS = ({
  en: {
    thisSite: 'this site', elsewhere: 'ELSEWHERE', withData: ' · WITH DATA ATTACHED', counter: 'visit counter', ads: 'ad loader',
    beforeCount: (n, c, a) => `${n} files loaded. ${n - c - a} of them are this page asking its own site for its own parts; ${c} ${c === 1 ? 'is' : 'are'} the visit counter firing as the page opened, and ${a} ${a === 1 ? 'is' : 'are'} the ad loader (Google AdSense) arriving the same way.`,
    verdict: (t, b, d, c, a) => `Requests since the witness started watching (just after this page loaded): ${t}. Of those, ${c} ${c === 1 ? 'was' : 'were'} the visit counter firing as the page opened and ${a} ${a === 1 ? 'was' : 'were'} the ad loader arriving as it opened; the rest are this page asking its own site for page and program files. Requests with anything attached to them: ${b}. Requests while the witnessed job was running: ${d}.`,
    sniff: { jpeg: 'JPEG photo', png: 'PNG picture', pdf: 'PDF document', gif: 'GIF picture', webp: 'WebP picture', zip: 'ZIP-based file', unknown: 'not recognised from its first bytes' },
    running: 'Job running: reading your file into this page\'s memory…',
    file: 'file', size: 'size', format: 'real format', fingerprint: 'fingerprint (SHA-256)', dimensions: 'dimensions', pages: 'pages', unreadable: 'could not be read', bytes: ' bytes',
    done: (n, c, a) => `Job done in this page's memory. Network requests during the job: ${n} (the visit counter's own among them: ${c}; the ad loader's own among them: ${a}). Your file was read, fingerprinted and described without a single request carrying it anywhere.`,
    failed: 'The job could not finish: ',
  },
  es: {
    thisSite: 'este sitio', elsewhere: 'OTRO SITIO', withData: ' · CON DATOS ADJUNTOS', counter: 'contador de visitas', ads: 'cargador de anuncios',
    beforeCount: (n, c, a) => `Se cargaron ${n} archivos. ${n - c - a} son pedidos de esta página a su propio sitio, para traerse los archivos que la forman; ${c} ${c === 1 ? 'corresponde' : 'corresponden'} al contador de visitas, que se activó cuando la página se abrió, y ${a} ${a === 1 ? 'corresponde' : 'corresponden'} al cargador de anuncios (Google AdSense), que llegó de la misma manera.`,
    verdict: (t, b, d, c, a) => `Peticiones desde que el testigo empezó a registrar (justo después de cargarse esta página): ${t}. De ellas, ${c} ${c === 1 ? 'fue' : 'fueron'} el contador de visitas activándose cuando la página se abrió y ${a} ${a === 1 ? 'fue' : 'fueron'} el cargador de anuncios llegando cuando se abrió; el resto son pedidos de esta página a su propio sitio, por archivos de la página y del programa. Peticiones con datos adjuntos: ${b}. Peticiones mientras se ejecutaba el trabajo de prueba: ${d}.`,
    sniff: { jpeg: 'foto JPEG', png: 'imagen PNG', pdf: 'documento PDF', gif: 'imagen GIF', webp: 'imagen WebP', zip: 'archivo basado en ZIP', unknown: 'no reconocido por sus primeros bytes' },
    running: 'Trabajo en curso: leyendo tu archivo en la memoria de esta página…',
    file: 'archivo', size: 'tamaño', format: 'formato real', fingerprint: 'huella (SHA-256)', dimensions: 'dimensiones', pages: 'páginas', unreadable: 'no se pudo leer', bytes: ' bytes',
    done: (n, c, a) => `Trabajo terminado en la memoria de esta página. Peticiones de red durante el trabajo: ${n} (las del contador de visitas entre ellas: ${c}; las del cargador de anuncios entre ellas: ${a}). Tu archivo fue leído, identificado y descrito sin que ninguna petición lo enviara a ningún sitio.`,
    failed: 'El trabajo no pudo terminar: ',
  },
  'pt-BR': {
    thisSite: 'este site', elsewhere: 'OUTRO SITE', withData: ' · COM DADOS ANEXADOS', counter: 'contador de visitas', ads: 'carregador de anúncios',
    beforeCount: (n, c, a) => `${n} arquivos carregados. ${n - c - a} deles são esta página pedindo ao seu próprio site as suas próprias partes; ${c} ${c === 1 ? 'é' : 'são'} o contador de visitas disparando quando a página abriu, e ${a} ${a === 1 ? 'é' : 'são'} o carregador de anúncios (Google AdSense) chegando da mesma forma.`,
    verdict: (t, b, d, c, a) => `Pedidos desde que a testemunha começou a observar (logo depois que esta página carregou): ${t}. Deles, ${c} ${c === 1 ? 'foi' : 'foram'} o contador de visitas disparando quando a página abriu e ${a} ${a === 1 ? 'foi' : 'foram'} o carregador de anúncios chegando quando ela abriu; o restante é esta página pedindo ao seu próprio site arquivos de página e de programa. Pedidos com algo anexado: ${b}. Pedidos enquanto o trabalho com testemunha rodava: ${d}.`,
    sniff: { jpeg: 'foto JPEG', png: 'imagem PNG', pdf: 'documento PDF', gif: 'imagem GIF', webp: 'imagem WebP', zip: 'arquivo baseado em ZIP', unknown: 'não reconhecido pelos primeiros bytes' },
    running: 'Trabalho em andamento: lendo o seu arquivo na memória desta página…',
    file: 'arquivo', size: 'tamanho', format: 'formato real', fingerprint: 'impressão digital (SHA-256)', dimensions: 'dimensões', pages: 'páginas', unreadable: 'não foi possível ler', bytes: ' bytes',
    done: (n, c, a) => `Trabalho terminado na memória desta página. Pedidos de rede durante o trabalho: ${n} (os do contador de visitas entre eles: ${c}; os do carregador de anúncios entre eles: ${a}). Seu arquivo foi lido, identificado e descrito sem que nenhum pedido o levasse para lugar nenhum.`,
    failed: 'O trabalho não conseguiu terminar: ',
  },
});
const W = W_SETS[document.documentElement.lang] || W_SETS.en;

const $ = (id) => document.getElementById(id);
const liveList = $('w-live'), beforeList = $('w-before'), verdict = $('w-verdict');
const jobLog = { during: 0, duringCounter: 0, duringAds: 0, withBody: 0, total: 0, counter: 0, ads: 0 };
let jobRunning = false;
const t0 = performance.now();
const rel = (ms) => ((ms - t0) / 1000).toFixed(1) + ' s';

function row(list, text) {
  const li = document.createElement('li');
  li.textContent = text;
  list.appendChild(li);
}
function sameOrigin(url) {
  try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
}
// The visit counter (milestone 19): the two Google hosts the counter's
// program and its count line travel to. Its requests are listed and
// labelled like everything else, and counted in their own bucket.
function isCounter(url) {
  try {
    const h = new URL(url, location.href).hostname;
    return h === 'www.googletagmanager.com' || h === 'www.google-analytics.com' || h.endsWith('.google-analytics.com');
  } catch { return false; }
}
// The ad loader (milestone 23): the one host the Google AdSense
// loader program travels to. Same treatment as the counter: listed,
// labelled, counted in its own bucket.
function isAds(url) {
  try {
    return new URL(url, location.href).hostname === 'pagead2.googlesyndication.com';
  } catch { return false; }
}
function shortUrl(url) {
  try { const u = new URL(url, location.href); return u.pathname; } catch { return url; }
}
function updateVerdict() {
  verdict.textContent = W.verdict(jobLog.total, jobLog.withBody, jobLog.during, jobLog.counter, jobLog.ads);
}
function noteRequest(kind, url, withBody) {
  const counter = isCounter(url);
  const ads = isAds(url);
  jobLog.total++;
  if (counter) jobLog.counter++;
  if (ads) jobLog.ads++;
  if (withBody) jobLog.withBody++;
  if (jobRunning) { jobLog.during++; if (counter) jobLog.duringCounter++; if (ads) jobLog.duringAds++; }
  row(liveList, `${rel(performance.now())} · ${kind} · ${shortUrl(url)} · ${sameOrigin(url) ? W.thisSite : W.elsewhere}${counter ? ' · ' + W.counter : ''}${ads ? ' · ' + W.ads : ''}${withBody ? W.withData : ''}`);
  updateVerdict();
}

// Watch fetch and XHR before anything else on this page can run a job.
const origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input.url;
  const withBody = !!(init && init.body) || (typeof input !== 'string' && input.method && input.method !== 'GET');
  noteRequest('fetch', url, withBody);
  return origFetch(input, init);
};
const origOpen = XMLHttpRequest.prototype.open;
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method, url) { this.__wUrl = url; return origOpen.apply(this, arguments); };
XMLHttpRequest.prototype.send = function (body) { noteRequest('xhr', this.__wUrl || '', !!body); return origSend.apply(this, arguments); };

// The browser's own record of what this page loaded before the witness
// armed, and anything it loads from now on.
const before = performance.getEntriesByType('resource');
let beforeCounter = 0;
let beforeAds = 0;
for (const e of before) {
  const counter = isCounter(e.name);
  const ads = isAds(e.name);
  if (counter) beforeCounter++;
  if (ads) beforeAds++;
  row(beforeList, `${(e.startTime / 1000).toFixed(1)} s · ${e.initiatorType || 'resource'} · ${shortUrl(e.name)} · ${sameOrigin(e.name) ? W.thisSite : W.elsewhere}${counter ? ' · ' + W.counter : ''}${ads ? ' · ' + W.ads : ''}`);
}
$('w-before-count').textContent = W.beforeCount(before.length, beforeCounter, beforeAds);
if ('PerformanceObserver' in window) {
  const seen = new Set(before.map((e) => e.name + '@' + e.startTime));
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (seen.has(e.name + '@' + e.startTime)) continue;
      seen.add(e.name + '@' + e.startTime);
      noteRequest(e.initiatorType || 'resource', e.name, false);
    }
  }).observe({ type: 'resource', buffered: true });
}
updateVerdict();

// The witnessed job: read a file, fingerprint and describe it, all in
// page memory. No engine downloads are triggered by this job: the code
// for it arrived with this page, which the lists above show.
function sniff(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  const s = (a) => String.fromCharCode(...a);
  if (b[0] === 0xff && b[1] === 0xd8) return W.sniff.jpeg;
  if (b[0] === 0x89 && s(b.slice(1, 4)) === 'PNG') return W.sniff.png;
  if (s(b.slice(0, 4)) === '%PDF') return W.sniff.pdf;
  if (s(b.slice(0, 4)) === 'GIF8') return W.sniff.gif;
  if (s(b.slice(0, 4)) === 'RIFF' && s(b.slice(8, 12)) === 'WEBP') return W.sniff.webp;
  if (s(b.slice(0, 4)) === 'PK\x03\x04') return W.sniff.zip;
  return W.sniff.unknown;
}

wireTray($('w-tray'), $('w-file'), async (f) => {
  const status = $('w-job-status'), spec = $('w-spec');
  status.textContent = W.running;
  jobRunning = true;
  const duringBefore = jobLog.during;
  const duringCounterBefore = jobLog.duringCounter;
  const duringAdsBefore = jobLog.duringAds;
  try {
    const buf = await f.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
    const rows = [
      [W.file, f.name],
      [W.size, fmtBytes(f.size) + ` (${f.size}${W.bytes})`],
      [W.format, sniff(buf)],
      [W.fingerprint, hex.slice(0, 32) + '…'],
    ];
    if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) {
      try { const bmp = await createImageBitmap(f); rows.push([W.dimensions, bmp.width + ' x ' + bmp.height]); } catch { /* not an image the browser can open */ }
    }
    if (sniff(buf) === W.sniff.pdf) {
      try { const doc = await PDFDocument.load(buf, { updateMetadata: false }); rows.push([W.pages, String(doc.getPageCount())]); } catch { rows.push([W.pages, W.unreadable]); }
    }
    spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    status.textContent = W.done(jobLog.during - duringBefore, jobLog.duringCounter - duringCounterBefore, jobLog.duringAds - duringAdsBefore);
  } catch (err) {
    status.textContent = W.failed + (err && err.message ? err.message : err);
  } finally {
    jobRunning = false;
    updateVerdict();
  }
});
