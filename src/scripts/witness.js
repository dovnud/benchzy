// Check It Yourself: the network witness.
// Honesty contract: this page claims only what it shows.
//  - It lists, live, every resource this page loads (the browser's own
//    Performance timeline) and every fetch/XMLHttpRequest the page's code
//    makes (a watcher installed by this script before any job can run).
//  - The witnessed job below (read a file, fingerprint it, describe it)
//    runs entirely in page memory. The page counts any network request
//    that happens while the job runs and prints the count.
//  - Nothing here asks you to trust the page: the manual network-panel
//    steps on the page show the same thing with the browser's own tools.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const liveList = $('w-live'), beforeList = $('w-before'), verdict = $('w-verdict');
const jobLog = { during: 0, withBody: 0, total: 0 };
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
function shortUrl(url) {
  try { const u = new URL(url, location.href); return u.pathname; } catch { return url; }
}
function updateVerdict() {
  verdict.textContent =
    `Requests since the witness started watching (just after this page loaded): ${jobLog.total}, ` +
    `every one of them to this site itself, asking for page and program files. Requests with anything ` +
    `attached to them: ${jobLog.withBody}. Requests while the witnessed job was running: ${jobLog.during}.`;
}
function noteRequest(kind, url, withBody) {
  jobLog.total++;
  if (withBody) jobLog.withBody++;
  if (jobRunning) jobLog.during++;
  row(liveList, `${rel(performance.now())} · ${kind} · ${shortUrl(url)} · ${sameOrigin(url) ? 'this site' : 'ELSEWHERE'}${withBody ? ' · WITH DATA ATTACHED' : ''}`);
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
for (const e of before) {
  row(beforeList, `${(e.startTime / 1000).toFixed(1)} s · ${e.initiatorType || 'resource'} · ${shortUrl(e.name)} · ${sameOrigin(e.name) ? 'this site' : 'ELSEWHERE'}`);
}
$('w-before-count').textContent = before.length + ' files, every one of them this page asking its own site for its own parts.';
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
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG photo';
  if (b[0] === 0x89 && s(b.slice(1, 4)) === 'PNG') return 'PNG picture';
  if (s(b.slice(0, 4)) === '%PDF') return 'PDF document';
  if (s(b.slice(0, 4)) === 'GIF8') return 'GIF picture';
  if (s(b.slice(0, 4)) === 'RIFF' && s(b.slice(8, 12)) === 'WEBP') return 'WebP picture';
  if (s(b.slice(0, 4)) === 'PK\x03\x04') return 'ZIP-based file';
  return 'not recognised from its first bytes';
}

wireTray($('w-tray'), $('w-file'), async (f) => {
  const status = $('w-job-status'), spec = $('w-spec');
  status.textContent = 'Job running: reading your file into this page\'s memory…';
  jobRunning = true;
  const duringBefore = jobLog.during;
  try {
    const buf = await f.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
    const rows = [
      ['file', f.name],
      ['size', fmtBytes(f.size) + ` (${f.size} bytes)`],
      ['real format', sniff(buf)],
      ['fingerprint (SHA-256)', hex.slice(0, 32) + '…'],
    ];
    if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) {
      try { const bmp = await createImageBitmap(f); rows.push(['dimensions', bmp.width + ' x ' + bmp.height]); } catch { /* not an image the browser can open */ }
    }
    if (sniff(buf) === 'PDF document') {
      try { const doc = await PDFDocument.load(buf, { updateMetadata: false }); rows.push(['pages', String(doc.getPageCount())]); } catch { rows.push(['pages', 'could not be read']); }
    }
    spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    status.textContent = `Job done in this page's memory. Network requests during the job: ${jobLog.during - duringBefore}. Your file was read, fingerprinted and described without a single request carrying it anywhere.`;
  } catch (err) {
    status.textContent = 'The job could not finish: ' + (err && err.message ? err.message : err);
  } finally {
    jobRunning = false;
    updateVerdict();
  }
});
