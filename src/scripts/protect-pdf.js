// Protect PDF: put a password on the visitor's own PDF. Engine:
// @cantoo/pdf-lib's standard security handler, AES-256 revision 6
// ONLY (the licence audit's condition 1: the weak ciphers are never
// selected anywhere in this codebase, and no code path passes the
// fork's weak-cryptography flag). The password is typed into this
// page and used inside this page; it is never sent anywhere, and
// nothing about it is stored — when the page closes it is gone.
// There is no recovery, by design, and the page says so before the
// run: a forgotten password means the file stays shut.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('pt-tray'), input = $('pt-file'), spec = $('pt-spec');
const runBtn = $('pt-run'), status = $('pt-status'), result = $('pt-result');
const pw1 = $('pt-pw1'), pw2 = $('pt-pw2'), showPw = $('pt-show');
let file = null, fileBytes = null, pages = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

showPw.addEventListener('change', () => {
  const t = showPw.checked ? 'text' : 'password';
  pw1.type = t;
  pw2.type = t;
});

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    pages = doc.getPageCount();
    if (doc.isEncrypted) {
      setSpec([
        ['file', f.name],
        ['size now', fmtBytes(f.size)],
        ['pages', String(pages)],
        ['protection', 'already has a password'],
      ]);
      setStatus('This file already has a password on it, so there is nothing to add here. To change it, take the old password off with the unlock tool first, then come back and protect it again.');
      return;
    }
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
      ['protection', 'none yet'],
    ]);
    setStatus('Ready. Type the password twice below, then protect the PDF.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  const pw = pw1.value;
  if (!pw) { setStatus('Type a password first. A password you will remember matters more than a clever one: there is no way back if you forget it.'); pw1.focus(); return; }
  // The floor is 12 characters (milestone 18, round-2 Missing 13):
  // length is what protects the file, so a short password is refused
  // here, before anything runs, with the reason stated.
  if (pw.length < 12) { setStatus('That password is ' + pw.length + ' characters. The minimum here is 12: length is what protects you, because a longer password takes far longer to guess. Add a few more words you will remember.'); pw1.focus(); return; }
  if (pw !== pw2.value) { setStatus('The two passwords do not match. Type the same one twice.'); pw2.focus(); return; }
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Protecting on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
    // AES-256 revision 6, the strongest current kind, and the only
    // one this page writes. The same typed password is set as both
    // the open password and the owner password: one password for the
    // visitor to remember, full access for whoever has it.
    doc.encrypt({ userPassword: pw, ownerPassword: pw, algorithm: 'AES-256' });
    const bytes = await doc.save();
    // Check the finished file the way a reader will meet it: shut
    // without the password, open with it, same page count.
    const shutWithout = await PDFDocument.load(bytes).then(() => false).catch(() => true);
    const opened = await PDFDocument.load(bytes, { password: pw });
    if (!shutWithout || opened.getPageCount() !== pages) {
      setStatus('The protected file did not check out, so nothing was delivered. Your original is untouched.');
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('pt-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-protected.pdf';
    $('pt-achieved').textContent = 'Protected: ' + pages + ' page' + (pages === 1 ? '' : 's') + ', ' + fmtBytes(bytes.length) +
      '. The file now asks for your password before it opens, and it was checked here: shut without it, open with it. ' +
      'Keep the password somewhere safe. If you forget it, the file stays shut, and no tool anywhere can change that.';
    result.classList.remove('hidden');
    const stamp = $('pt-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Protect PDF', name: file.name, detail: 'AES-256 password added' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
