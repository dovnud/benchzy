// Convert one image, one direction: the six preset doors (PNG to JPG,
// JPG to PNG, WebP to JPG, JPG to WebP, PNG to WebP, WebP to PNG). Each
// page sets data-from / data-to on its ticket; the conversion itself is
// the shipped batch-convert engine (lib/image-core, jSquash), so a door
// and the batch page can never disagree about a result. A door is a
// page on that tool, not a new tool, and the build counts it that way.
// The alpha rule is stated on the door before the run and kept here:
// JPG cannot hold see-through pixels, so a transparent picture is
// painted over the colour the visitor picked (white unless changed).
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { initImageCodecs, decodeImageFile, encodeImage, hasAlpha, flattenOnto } from './lib/image-core.js';

const $ = (id) => document.getElementById(id);
const toolEl = $('cv-tool');
const FROM = toolEl.dataset.from;
const TO = toolEl.dataset.to;
const NAMES = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
const DOORS = {
  'png>jpeg': '/png-to-jpg/', 'jpeg>png': '/jpg-to-png/', 'webp>jpeg': '/webp-to-jpg/',
  'jpeg>webp': '/jpg-to-webp/', 'png>webp': '/png-to-webp/', 'webp>png': '/webp-to-png/',
};
const tray = $('cv-tray'), input = $('cv-file'), spec = $('cv-spec');
const runBtn = $('cv-run'), status = $('cv-status'), result = $('cv-result');
let file = null, running = false, quality = 90, bg = '#ffffff';

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function fileFormat(f) {
  if (f.type === 'image/jpeg') return 'jpeg';
  if (f.type === 'image/png') return 'png';
  if (f.type === 'image/webp') return 'webp';
  const m = /\.([a-z0-9]+)$/i.exec(f.name || '');
  if (m) {
    const e = m[1].toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'jpeg';
    if (e === 'png') return 'png';
    if (e === 'webp') return 'webp';
  }
  return null;
}

const qEl = $('cv-quality');
if (qEl) qEl.addEventListener('change', () => {
  const v = parseInt(qEl.value, 10);
  if (v >= 1 && v <= 100) quality = v;
});
const bgEl = $('cv-bg');
if (bgEl) bgEl.addEventListener('input', () => { bg = bgEl.value; });
document.querySelectorAll('#cv-bgs .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#cv-bgs .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    bg = chip.dataset.bg;
    if (bgEl) bgEl.value = bg;
  });
});

// A file at the wrong door gets pointed at the right ones, in the open:
// this door takes FROM; for the file in hand, the doors that start
// from its own format are the answer.
function wrongDoor(fmt) {
  status.textContent = '';
  const lead = document.createElement('span');
  lead.textContent = 'This door starts from a ' + NAMES[FROM] + ' file. Your file is '
    + (fmt ? 'a ' + NAMES[fmt] : 'not a JPG, PNG or WebP') + '. ';
  status.appendChild(lead);
  if (fmt) {
    const others = Object.keys(DOORS).filter((k) => k.startsWith(fmt + '>') && DOORS[k] !== location.pathname);
    others.forEach((k, i) => {
      const to = k.split('>')[1];
      const a = document.createElement('a');
      a.className = 'underline underline-offset-4';
      a.href = DOORS[k];
      a.textContent = NAMES[fmt] + ' to ' + NAMES[to];
      status.appendChild(a);
      if (i < others.length - 1) status.appendChild(document.createTextNode(' · '));
    });
    status.appendChild(document.createTextNode(' start from your file.'));
  }
}

wireTray(tray, input, (f) => {
  file = f;
  result.classList.add('hidden');
  const fmt = fileFormat(f);
  if (fmt !== FROM) {
    runBtn.disabled = true;
    file = null;
    wrongDoor(fmt);
    setSpec([['file', f.name], ['this door takes', NAMES[FROM] + ' files']]);
    return;
  }
  runBtn.disabled = false;
  setSpec([
    ['file', f.name],
    ['format', NAMES[fmt] + ' (this door\'s starting format)'],
    ['size now', fmtBytes(f.size)],
    ['comes out as', NAMES[TO]],
  ]);
  setStatus('Ready. Press Convert and the ' + NAMES[TO] + ' is made here in the page; nothing is uploaded.');
});

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Loading the image program (about 2 MB, one time only). It runs in your browser to protect your privacy: your file never leaves your device…');
    await initImageCodecs();
    setStatus('Reading the ' + NAMES[FROM] + '…');
    let img = await decodeImageFile(file, await file.arrayBuffer());
    let flattened = false;
    if (TO === 'jpeg' && hasAlpha(img)) {
      img = flattenOnto(img, bg);
      flattened = true;
    }
    setStatus('Writing the ' + NAMES[TO] + '…');
    const r = await encodeImage(img, TO, quality, null);
    const blob = new Blob([r.buf], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const dl = $('cv-download');
    const base = file.name.replace(/\.[^.]+$/, '');
    dl.href = url;
    dl.download = base + '.' + r.ext;
    let note = NAMES[FROM] + ', ' + fmtBytes(file.size) + ' → ' + NAMES[TO] + ', ' + fmtBytes(r.bytes)
      + (TO === 'png' ? ' (lossless: every pixel of the decoded picture, written exactly)' : ' (quality ' + quality + ')')
      + '. Dimensions unchanged: ' + r.width + ' x ' + r.height + ' px.';
    if (flattened) note += ' The see-through parts were painted over ' + bg + ', because JPG cannot hold transparency.';
    $('cv-achieved').textContent = note;
    const prev = $('cv-preview');
    prev.src = url;
    prev.classList.remove('hidden');
    result.classList.remove('hidden');
    const stamp = $('cv-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Convert ' + NAMES[FROM] + ' to ' + NAMES[TO], name: file.name, detail: fmtBytes(file.size) + ' to ' + fmtBytes(r.bytes) });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
