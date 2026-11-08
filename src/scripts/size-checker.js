// Size checker: drop any file and read its exact spec, here in the page.
// Nothing is converted and nothing is uploaded; this is the landing step
// for form-rejection jobs (BUILD-PLAN item 24): a portal said "file too
// large" or "wrong size", and the first thing anyone needs is the truth
// about the file they actually have.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('sc-tray'), input = $('sc-file'), spec = $('sc-spec');
const status = $('sc-status'), doorsEl = $('sc-doors');
const LIMITS = [200, 500, 1024, 2048, 5120, 10240, 25600]; // KB doors portals use

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function sniff(b) {
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (s(0, 4) === '%PDF') return 'PDF document';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'JPEG image';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'PNG image';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'WebP image';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'WAV audio';
  if (s(0, 3) === 'GIF') return 'GIF image';
  if (s(4, 4) === 'ftyp') return 'MP4 / MOV video';
  if (s(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'MP3 audio';
  if (b[0] === 0x50 && b[1] === 0x4B) return 'ZIP archive';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'WebM / Matroska video';
  return null;
}

wireTray(tray, input, async (f) => {
  doorsEl.innerHTML = '';
  setStatus('Reading the file here in the page…');
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    const kind = sniff(buf) || (f.type ? f.type + ' (as the file claims)' : 'unknown type');
    const rows = [
      ['file', f.name],
      ['exact size', buf.length.toLocaleString('en-US') + ' bytes'],
      ['size', fmtBytes(buf.length) + '  ·  ' + (buf.length / 1000).toFixed(1) + ' KB (counting 1 KB = 1,000 bytes)'],
      ['what it is', kind],
    ];
    if (kind === 'PDF document') {
      const doc = await PDFDocument.load(buf, { updateMetadata: false });
      const first = doc.getPage(0);
      const { width, height } = first.getSize();
      rows.push(['pages', String(doc.getPageCount())]);
      rows.push(['page size', Math.round(width) + ' x ' + Math.round(height) + ' pt (' + (width * 25.4 / 72).toFixed(0) + ' x ' + (height * 25.4 / 72).toFixed(0) + ' mm)']);
    } else if (/image/.test(kind) || /^image\//.test(f.type)) {
      try {
        const bmp = await createImageBitmap(f);
        rows.push(['dimensions', bmp.width + ' x ' + bmp.height + ' pixels']);
        bmp.close();
      } catch (e) { rows.push(['dimensions', 'could not be decoded by this browser']); }
    } else if (/video|MP4/.test(kind) || /^video\//.test(f.type) || /audio|MP3|WAV/.test(kind) || /^audio\//.test(f.type)) {
      const meta = await new Promise((resolve) => {
        const el = document.createElement(/video/.test(kind) || /^video/.test(f.type) || /MP4/.test(kind) ? 'video' : 'audio');
        const url = URL.createObjectURL(f);
        el.preload = 'metadata';
        el.onloadedmetadata = () => {
          const out = { duration: el.duration, w: el.videoWidth || 0, h: el.videoHeight || 0 };
          URL.revokeObjectURL(url);
          resolve(out);
        };
        el.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        el.src = url;
      });
      if (meta && isFinite(meta.duration)) {
        rows.push(['duration', Math.floor(meta.duration / 60) + ':' + String(Math.floor(meta.duration % 60)).padStart(2, '0')]);
        if (meta.w) rows.push(['frame size', meta.w + ' x ' + meta.h + ' pixels']);
      }
    }
    setSpec(rows);
    // The common doors: is this file under each limit portals actually set?
    const kb = buf.length / 1024;
    doorsEl.innerHTML = LIMITS.map((L) => {
      const under = kb <= L;
      const label = L >= 1024 ? (L / 1024) + ' MB' : L + ' KB';
      return '<div class="spec-row"><dt>' + label + ' door</dt><dd>' +
        (under ? 'fits, ' + fmtBytes((L - kb) * 1024) + ' to spare' : 'too big by ' + fmtBytes((kb - L) * 1024)) +
        '</dd></div>';
    }).join('');
    setStatus('Done. Nothing was uploaded; the file never left this page.');
    recordJob({ tool: 'Size checker', name: f.name, detail: fmtBytes(buf.length) + ', ' + kind });
  } catch (err) {
    setStatus('That file could not be read here: ' + (err && err.message ? err.message : err));
  }
});
