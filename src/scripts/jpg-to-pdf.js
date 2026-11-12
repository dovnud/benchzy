// Pictures to PDF: several pictures in, one PDF out, one picture
// per page, in the order on the list. Engine: @cantoo/pdf-lib
// embeds. JPEG and PNG files go into the PDF exactly as they are
// stored (no recompression, so nothing loses quality); a WebP or
// HEIC picture is first rebuilt as a PNG through the shipped image
// stack, because a PDF cannot hold either — PNG is lossless, so
// the picture itself is unchanged pixel for pixel. Decoded
// dimensions come from the browser's own image reader before the
// run, so the list shows real sizes, and the finished file is
// re-opened and its pages counted before the download is offered.
//
// Milestone 24: this one island also runs the /png-to-pdf/ door
// (PNG pictures only) and the /image-to-pdf/ door (JPG, PNG, WebP
// and HEIC mixed). The door pages set their shape on #jp-tool,
// the same data-attribute pattern the compress preset doors use:
// data-kinds (the picture kinds the door takes), data-kinds-label
// (how those kinds are named in the page's own sentences),
// data-preset-key, data-download-name and data-tool-name. With no
// attributes set, everything below is exactly the milestone-14
// JPG to PDF behaviour.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, savePreset, getPreset, wireTrayMulti } from './workbench.js';
import { initImageCodecs, decodeImageFile, encodeImage } from './lib/image-core.js';
import { decodeHeicToImageData } from './lib/heif-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('jp-tray'), input = $('jp-file'), listEl = $('jp-list');
const spec = $('jp-spec'), runBtn = $('jp-run'), status = $('jp-status'), result = $('jp-result');
const toolEl = $('jp-tool');
const KINDS = ((toolEl && toolEl.dataset.kinds) || 'jpeg,png,webp').split(',').map((s) => s.trim()).filter(Boolean);
const KINDS_LABEL = (toolEl && toolEl.dataset.kindsLabel) || 'JPG, PNG or WebP';
const PRESET_KEY = (toolEl && toolEl.dataset.presetKey) || 'jpg-to-pdf';
const DOWNLOAD_NAME = (toolEl && toolEl.dataset.downloadName) || 'pictures-benchzy.pdf';
const TOOL_NAME = (toolEl && toolEl.dataset.toolName) || 'JPG to PDF';
let entries = []; // { file, kind, bytes, width, height, error }
let codecsReady = false, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
const picked = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

const saved = getPreset(PRESET_KEY);
if (saved && saved.fit) {
  const r = document.querySelector('input[name="jp-fit"][value="' + saved.fit + '"]');
  if (r) r.checked = true;
}
for (const el of document.querySelectorAll('input[name="jp-fit"]')) {
  el.addEventListener('change', () => savePreset(PRESET_KEY, { fit: picked('jp-fit') || 'own' }));
}

function kindOf(f) {
  let kind = null;
  if (f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)) kind = 'jpeg';
  else if (f.type === 'image/png' || /\.png$/i.test(f.name)) kind = 'png';
  else if (f.type === 'image/webp' || /\.webp$/i.test(f.name)) kind = 'webp';
  else if (f.type === 'image/heic' || f.type === 'image/heif' || /\.hei[cf]$/i.test(f.name)) kind = 'heic';
  return kind && KINDS.includes(kind) ? kind : null;
}

function totals() {
  const ok = entries.filter((e) => !e.error);
  return { files: entries.length, ok: ok.length, bytes: entries.reduce((a, e) => a + e.file.size, 0) };
}

function refresh() {
  const t = totals();
  setSpec([
    ['pictures on the tray', String(t.files)],
    ['pages they will make', String(t.ok)],
    ['size in', fmtBytes(t.bytes)],
  ]);
  runBtn.disabled = !(t.ok >= 1) || running;
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + e.file.name;
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2 flex-wrap justify-end';
    const meta = document.createElement('span');
    meta.textContent = e.error ? e.error : e.width + ' x ' + e.height + ' px · ' + fmtBytes(e.file.size);
    if (e.error) meta.className = 'text-accent-deep';
    right.appendChild(meta);
    const mk = (act, label, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.act = act;
      b.dataset.pos = String(i);
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    right.append(
      mk('up', 'Up', () => { [entries[i - 1], entries[i]] = [entries[i], entries[i - 1]]; refresh(); }, i === 0),
      mk('down', 'Down', () => { [entries[i + 1], entries[i]] = [entries[i], entries[i + 1]]; refresh(); }, i === entries.length - 1),
      mk('del', 'Remove', () => { entries.splice(i, 1); refresh(); }, false),
    );
    li.append(left, right);
    listEl.appendChild(li);
  });
  if (entries.length === 0) setStatus('Pick one or more pictures to begin.');
  else if (t.ok === 0) setStatus('None of those files is a ' + KINDS_LABEL + ' picture. Add one of those to begin.');
  else setStatus('Ready. The PDF follows the order on this list, top to bottom: the first picture becomes page 1.');
}

wireTrayMulti(tray, input, async (files) => {
  result.classList.add('hidden');
  for (const f of files) {
    const kind = kindOf(f);
    const entry = { file: f, kind, bytes: null, width: 0, height: 0, error: null };
    if (!kind) {
      entry.error = 'not a ' + KINDS_LABEL + ' picture';
    } else {
      try {
        entry.bytes = new Uint8Array(await f.arrayBuffer());
        if (kind === 'heic') {
          // The browser's own reader cannot open HEIC; the shipped
          // HEIC reader (lib/heif-core.js) reports the real size,
          // orientation already applied, exactly as at run time.
          const decoded = await decodeHeicToImageData(entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength));
          entry.width = decoded.imageData.width;
          entry.height = decoded.imageData.height;
        } else {
          const bmp = await createImageBitmap(f);
          entry.width = bmp.width;
          entry.height = bmp.height;
          if (bmp.close) bmp.close();
        }
      } catch (err) {
        entry.error = 'could not be read as a picture';
      }
    }
    entries.push(entry);
  }
  refresh();
});

const FITS = {
  own: { label: 'each page sized to its picture' },
  a4: { label: 'fitted onto A4 pages', size: [595.28, 841.89] },
  letter: { label: 'fitted onto Letter pages', size: [612, 792] },
};
const MARGIN = 36; // half an inch of quiet border on the sheet sizes

runBtn.addEventListener('click', async () => {
  const ok = entries.filter((e) => !e.error);
  if (ok.length < 1 || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  const fit = picked('jp-fit') || 'own';
  try {
    const rebuildKinds = [...new Set(ok.filter((e) => e.kind === 'webp' || e.kind === 'heic').map((e) => e.kind))];
    if (rebuildKinds.length && !codecsReady) {
      if (rebuildKinds.includes('heic')) {
        setStatus('Loading the HEIC reader and the image program (one time only) to rebuild those pictures as PNG inside the PDF. They run in your browser to protect your privacy: your pictures never leave your device…');
      } else {
        setStatus('Loading the image program (about 2 MB, one time only) to rebuild the WebP picture(s) as PNG. It runs in your browser to protect your privacy: your pictures never leave your device…');
      }
      await initImageCodecs();
      codecsReady = true;
    }
    setStatus('Building the PDF on this device…');
    const doc = await PDFDocument.create();
    let rebuilt = 0;
    const rebuiltKindsSeen = [];
    for (const e of ok) {
      let img;
      if (e.kind === 'jpeg') img = await doc.embedJpg(e.bytes);
      else if (e.kind === 'png') img = await doc.embedPng(e.bytes);
      else {
        const decoded = await decodeImageFile(e.file, e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength));
        const png = await encodeImage(decoded, 'png');
        img = await doc.embedPng(png.buf);
        rebuilt++;
        if (!rebuiltKindsSeen.includes(e.kind)) rebuiltKindsSeen.push(e.kind);
      }
      if (fit === 'own') {
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else {
        const [pw, ph] = FITS[fit].size;
        const page = doc.addPage([pw, ph]);
        const scale = Math.min((pw - MARGIN * 2) / img.width, (ph - MARGIN * 2) / img.height);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
    }
    const bytes = await doc.save();
    // Re-open the finished file and count its pages: the result line
    // reports the file's own numbers, not the plan.
    const after = await PDFDocument.load(bytes, { updateMetadata: false });
    const made = after.getPageCount();
    if (made !== ok.length) throw new Error('the finished file holds ' + made + ' pages, not ' + ok.length);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('jp-download');
    dl.href = url;
    dl.download = DOWNLOAD_NAME;
    const directCount = ok.length - rebuilt;
    const rebuiltNames = rebuiltKindsSeen.map((k) => (k === 'webp' ? 'WebP' : 'HEIC')).join(' and ');
    $('jp-achieved').textContent =
      ok.length + ' picture' + (ok.length === 1 ? '' : 's') + ' became one PDF of ' + made + ' pages, ' + fmtBytes(bytes.length) +
      ', ' + FITS[fit].label + '.' +
      (directCount ? ' JPEG and PNG pictures went in exactly as stored, with no recompression.' : '') +
      (rebuilt ? ' ' + rebuilt + ' ' + rebuiltNames + ' picture' + (rebuilt === 1 ? ' was' : 's were') + ' rebuilt as PNG inside the PDF (a PDF cannot hold ' + rebuiltNames + '; PNG keeps every pixel, so the picture is unchanged).' : '');
    result.classList.remove('hidden');
    const stamp = $('jp-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: TOOL_NAME, name: ok.length + ' pictures', detail: made + ' pages, ' + fmtBytes(bytes.length) });
  } catch (err) {
    setStatus('Something went wrong with these pictures: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
