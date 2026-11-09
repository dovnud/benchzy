// PDF metadata: see the details a PDF stores about itself (its
// label card), change the title and author, or wipe the card clean.
// The pages themselves are never touched by this tool: it reads and
// writes the document's info entries (and the XMP copy some files
// carry), nothing else. Engine: @cantoo/pdf-lib, loaded with
// updateMetadata off so saving never stamps our own name or the
// date into the card behind the visitor's back.
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('md-tray'), input = $('md-file'), spec = $('md-spec'), view = $('md-view');
const saveBtn = $('md-save'), stripBtn = $('md-strip'), status = $('md-status'), result = $('md-result');
const titleInput = $('md-title'), authorInput = $('md-author');
let file = null, fileBytes = null, currentBytes = null, running = false;

const DETAIL_KEYS = [
  ['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Keywords', 'keywords'],
  ['Creator', 'creator'], ['Producer', 'producer'], ['CreationDate', 'created'], ['ModDate', 'modified'],
];
// Internal key -> the info dictionary's own entry name.
const INFO_NAMES = {
  title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords',
  creator: 'Creator', producer: 'Producer', created: 'CreationDate', modified: 'ModDate',
};
const GETTERS = {
  title: (d) => d.getTitle(), author: (d) => d.getAuthor(), subject: (d) => d.getSubject(),
  keywords: (d) => d.getKeywords(), creator: (d) => d.getCreator(), producer: (d) => d.getProducer(),
};

function setStatus(msg) { status.textContent = msg; }
function rowsHtml(rows) {
  return rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function setSpec(rows) { spec.innerHTML = rowsHtml(rows); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function infoDict(doc) {
  const ref = doc.context.trailerInfo.Info;
  return ref ? doc.context.lookup(ref) : null;
}
// Dates are shown in the file's own stored format (D: then year,
// month, day, hour, minute, second), exactly as the file carries
// them, so what the visitor reads is what the file says.
function rawStored(doc, key) {
  try {
    const info = infoDict(doc);
    if (!info) return null;
    const v = info.get(PDFName.of(key));
    if (!v || typeof v.decodeText !== 'function') return null;
    return v.decodeText();
  } catch (e) { return null; }
}
// The stored digits read as a plain date, in the file's own
// wall-clock numbers: no timezone conversion is applied, so the
// reading can never drift from what the file says (milestone 18,
// round-2 Unclear 18). Returns null when the stored value is not a
// D: date this parser recognises.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function humanDate(raw) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  let out = '';
  if (mo && d) out = parseInt(d, 10) + ' ' + (MONTH_NAMES[parseInt(mo, 10) - 1] || mo) + ' ' + y;
  else if (mo) out = (MONTH_NAMES[parseInt(mo, 10) - 1] || mo) + ' ' + y;
  else out = y;
  if (h !== undefined) {
    out += ', ' + h + ':' + (mi || '00') + ':' + (s || '00');
  }
  return out;
}
function detailValue(doc, key) {
  if (key === 'created' || key === 'modified') {
    const raw = rawStored(doc, key === 'created' ? 'CreationDate' : 'ModDate');
    if (raw) {
      const human = humanDate(raw);
      return human ? raw + ' — read as: ' + human : raw;
    }
    const d = key === 'created' ? doc.getCreationDate() : doc.getModificationDate();
    return d ? d.toISOString() : null;
  }
  try {
    const v = GETTERS[key](doc);
    return v === undefined || v === '' ? null : v;
  } catch (e) { return null; }
}
function presentKeys(doc) {
  return DETAIL_KEYS.filter(([, key]) => detailValue(doc, key) !== null).map(([label]) => label);
}
function pdfVersion(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 16));
  const m = head.match(/%PDF-(\d\.\d)/);
  return m ? m[1] : 'not readable';
}

async function showState(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const rows = [];
  for (const [label, key] of DETAIL_KEYS) {
    const v = detailValue(doc, key);
    rows.push([label.toLowerCase(), v === null ? 'not set' : escapeHtml(v)]);
  }
  const xmp = !!doc.catalog.get(PDFName.of('Metadata'));
  if (xmp) rows.push(['second copy', 'an XMP details block is also stored in this file']);
  rows.push(['pdf version', pdfVersion(bytes)]);
  rows.push(['pages', String(doc.getPageCount())]);
  rows.push(['file size', fmtBytes(bytes.length)]);
  view.innerHTML = rowsHtml(rows);
  titleInput.value = detailValue(doc, 'title') || '';
  authorInput.value = detailValue(doc, 'author') || '';
  return doc;
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  saveBtn.disabled = true;
  stripBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    currentBytes = fileBytes;
    const probe = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(probe.getPageCount())],
    ]);
    if (probe.isEncrypted) {
      view.innerHTML = rowsHtml([['stored details', 'behind the password — this page cannot read them']]);
      setStatus('This file has a password on it, so this page cannot read its stored details. Take the password off first with the unlock tool, then bring the file back here.');
      return;
    }
    await showState(currentBytes);
    setStatus('These are the details the file stores about itself, exactly as stored. Change the title or author, or wipe the whole card.');
    saveBtn.disabled = false;
    stripBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

async function finish(bytes, achieved, jobDetail, suffix) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const dl = $('md-download');
  dl.href = URL.createObjectURL(blob);
  dl.download = file.name.replace(/\.pdf$/i, '') + suffix;
  $('md-achieved').textContent = achieved;
  result.classList.remove('hidden');
  const stamp = $('md-stamp');
  stamp.classList.remove('land');
  void stamp.offsetWidth;
  stamp.classList.add('land');
  currentBytes = bytes;
  await showState(bytes);
  setStatus('Done. The table above now shows the finished file\'s details.');
  recordJob({ tool: 'PDF metadata', name: file.name, detail: jobDetail });
}

saveBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  saveBtn.disabled = true;
  stripBtn.disabled = true;
  result.classList.add('hidden');
  try {
    const doc = await PDFDocument.load(currentBytes, { updateMetadata: false });
    const info = infoDict(doc);
    const title = titleInput.value.trim();
    const author = authorInput.value.trim();
    if (title) doc.setTitle(title); else if (info) info.delete(PDFName.of('Title'));
    if (author) doc.setAuthor(author); else if (info) info.delete(PDFName.of('Author'));
    const bytes = await doc.save();
    await finish(bytes,
      'Label card saved: title reads "' + (title || 'not set') + '", author reads "' + (author || 'not set') + '", ' + fmtBytes(bytes.length) + '. ' +
      'The other stored details were left as they were, and the pages were not touched.',
      'title/author set', '-details.pdf');
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    saveBtn.disabled = false;
    stripBtn.disabled = false;
  }
});

stripBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  saveBtn.disabled = true;
  stripBtn.disabled = true;
  result.classList.add('hidden');
  try {
    const doc = await PDFDocument.load(currentBytes, { updateMetadata: false });
    const present = presentKeys(doc);
    const hadXmp = !!doc.catalog.get(PDFName.of('Metadata'));
    if (!present.length && !hadXmp) {
      setStatus('This file carries no stored details to wipe: its label card is already blank. Nothing was changed and there is nothing to download.');
      return;
    }
    const info = infoDict(doc);
    if (info) for (const [, key] of DETAIL_KEYS) info.delete(PDFName.of(INFO_NAMES[key]));
    if (hadXmp) doc.catalog.delete(PDFName.of('Metadata'));
    const bytes = await doc.save();
    const names = present.map((l) => l.toLowerCase()).join(', ');
    await finish(bytes,
      'Wiped: ' + (names || 'no standard lines') + (hadXmp ? ', and the XMP second copy' : '') + '. The finished file\'s card is blank, ' + fmtBytes(bytes.length) + '. ' +
      'The pages, their words and pictures are exactly as they were: wiping the label card is not cleaning the document.',
      'details wiped', '-details-wiped.pdf');
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    saveBtn.disabled = false;
    stripBtn.disabled = false;
  }
});
