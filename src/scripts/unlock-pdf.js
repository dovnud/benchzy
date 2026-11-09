// Unlock PDF: take the password off the visitor's own PDF, on the
// @cantoo/pdf-lib fork. The flow the fidelity bench proved (verify/
// m9-bench.mjs, 28 of 28 corpus cases: RC4 R2 to AES-256 R6, open
// passwords and permissions-only passwords, form values, attachments,
// signature structure and a 300-page file all carried over):
//   1. load with the password the visitor typed (or the empty
//      password, for a file that opens with its switches off),
//   2. delete the source's own encryption dictionary object and the
//      stale cross-reference stream object the parser carried into
//      the context — a plain load-and-save leaves both behind, and
//      the finished file then still points at the old protection,
//   3. save, then re-open the output with no password and check it
//      before anything is offered for download.
// The password is typed into this page and used inside this page;
// it is never sent anywhere and never stored.
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('un-tray'), input = $('un-file'), spec = $('un-spec');
const runBtn = $('un-run'), status = $('un-status'), result = $('un-result');
const pwInput = $('un-pw'), showPw = $('un-show');
let file = null, fileBytes = null, pages = 0, kind = null, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function stripStaleProtectionObjects(doc) {
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    // The source's cross-reference stream survives the parse as an
    // unparsed raw object whose bytes are its old dictionary (which
    // names the old protection). It is never content; drop it.
    if (obj && obj.constructor && obj.constructor.name === 'PDFInvalidObject' && obj.data) {
      const headBytes = obj.data.slice(0, 256);
      let head = '';
      for (let i = 0; i < headBytes.length; i++) head += String.fromCharCode(headBytes[i]);
      if (/\/Type\s*\/XRef/.test(head)) { ctx.delete(ref); continue; }
    }
    // NB: a PDFDict's own .dict property is its internal Map, so the
    // instanceof check must come before any .dict access.
    let dict = null;
    if (obj instanceof PDFDict) dict = obj;
    else if (obj && obj.dict instanceof PDFDict) dict = obj.dict;
    if (!dict) continue;
    let type, filter;
    try {
      type = dict.lookup(PDFName.of('Type'));
      filter = dict.lookup(PDFName.of('Filter'));
    } catch (e) { continue; }
    const isOldXrefStream = type === PDFName.of('XRef');
    const isEncryptionDict = filter === PDFName.of('Standard') &&
      !!dict.lookup(PDFName.of('V')) && !!dict.lookup(PDFName.of('O')) && !!dict.lookup(PDFName.of('U'));
    if (isOldXrefStream || isEncryptionDict) ctx.delete(ref);
  }
}

showPw.addEventListener('change', () => { pwInput.type = showPw.checked ? 'text' : 'password'; });

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  kind = null;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const probe = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    pages = probe.getPageCount();
    if (!probe.isEncrypted) {
      setSpec([
        ['file', f.name],
        ['size now', fmtBytes(f.size)],
        ['pages', String(pages)],
        ['password', 'none on this file'],
      ]);
      setStatus('This file has no password on it. It already opens for anyone, so there is nothing to take off.');
      return;
    }
    // Which kind is it? A file that loads with the empty password is
    // the permissions kind: it opens, with its switches off.
    try {
      await PDFDocument.load(fileBytes, { updateMetadata: false, password: '' });
      kind = 'permissions';
    } catch (e) {
      kind = 'open';
    }
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
      ['password', kind === 'permissions' ? 'opens; print/copy/edit switches are off' : 'asks for a password to open'],
    ]);
    if (kind === 'permissions') {
      setStatus('This file opens without a password; only its permission switches are on. Leave the password box empty and press the button: the switches come off, because that is how PDF permissions work.');
    } else {
      setStatus('This file asks for a password to open. Type that password below: it must be the right one, and there is no other way, here or anywhere.');
    }
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || !kind || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  const typed = pwInput.value;
  try {
    setStatus('Taking the password off, on this device…');
    let doc;
    try {
      doc = await PDFDocument.load(fileBytes, { updateMetadata: false, password: typed });
    } catch (e) {
      if (!typed) setStatus('This file asks for a password to open, and the box is empty. Type the password above; there is no way around it.');
      else setStatus('That password did not open the file. Check it and try again.');
      return;
    }
    stripStaleProtectionObjects(doc);
    const bytes = await doc.save();
    // Check the finished file before offering it: opens with no
    // password, carries no protection, same page count.
    const check = await PDFDocument.load(bytes, { updateMetadata: false });
    if (check.isEncrypted || check.getPageCount() !== pages) {
      setStatus('The finished file did not check out, so nothing was delivered. Your original is untouched.');
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('un-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-unlocked.pdf';
    $('un-achieved').textContent = 'Password taken off: ' + pages + ' page' + (pages === 1 ? '' : 's') + ', ' + fmtBytes(bytes.length) +
      '. The finished file opens with no password, and it was checked here before you downloaded it. ' +
      'The content was carried over whole: pages, form answers and attachments were all counted against the original in our own testing of this tool.';
    result.classList.remove('hidden');
    const stamp = $('un-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Unlock PDF', name: file.name, detail: kind === 'permissions' ? 'permission switches taken off' : 'password taken off' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
