// Flatten PDF: bake a filled form's field values into the pages, so the
// finished file shows the same answers everywhere and the fields can no
// longer be edited. Engine: @cantoo/pdf-lib's form API (a core API of the
// measured library). Honest scope, printed on the page: form fields are
// flattened here; other annotation kinds (highlights, sticky notes,
// stamps added by other programs) are COUNTED and reported, never
// silently dropped, because this engine cannot bake them into the page.
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('fl-tray'), input = $('fl-file'), spec = $('fl-spec');
const runBtn = $('fl-run'), status = $('fl-status'), result = $('fl-result');
let file = null, fileBytes = null, running = false;
let info = null; // { pages, fields, otherAnnots }

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  let fields = 0;
  try { fields = doc.getForm().getFields().length; } catch (e) { fields = 0; }
  let otherAnnots = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      // Annotation entries arrive in more than one internal shape
      // (dict, stream, ref); read the subtype defensively and never
      // let the count break the inspection.
      let s = '';
      try {
        const a = annots.lookup(i);
        const dict = a && typeof a.lookup === 'function' ? a : (a && a.dict && typeof a.dict.lookup === 'function' ? a.dict : null);
        const sub = dict ? dict.lookup(PDFName.of('Subtype')) : null;
        s = sub ? sub.toString() : '';
      } catch (e) { s = ''; }
      if (s !== '/Widget') otherAnnots++;
    }
  }
  return { pages: doc.getPageCount(), fields, otherAnnots };
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    info = await inspect(fileBytes);
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(info.pages)],
      ['form fields', String(info.fields)],
      ['other annotations', String(info.otherAnnots)],
    ]);
    if (info.fields === 0) setStatus('This PDF has no form fields to flatten. You can still run it: the file comes back re-saved, and the result line will say nothing was flattened.');
    else setStatus('Ready. ' + info.fields + ' form field' + (info.fields === 1 ? '' : 's') + ' will be baked into the pages.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || !info || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Flattening on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields().length;
    if (fields > 0) {
      try { form.updateFieldAppearances(); } catch (e) { /* flatten uses existing appearances */ }
      form.flatten();
    }
    const bytes = await doc.save();
    // Re-open the output and count again: the result line reports the
    // flattened file's own numbers, not the plan.
    const after = await inspect(bytes);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('fl-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-flattened.pdf';
    let note;
    if (fields > 0) {
      note = 'Flattened: ' + fields + ' form field' + (fields === 1 ? '' : 's') + ' baked into the pages; the finished file has ' +
        after.fields + ' editable fields left, ' + fmtBytes(bytes.length) + '. The values now print and display as ordinary page content.';
    } else {
      note = 'Nothing to flatten: this PDF had no form fields. Here it is back, re-saved and unchanged in content, ' + fmtBytes(bytes.length) + '.';
    }
    if (info.otherAnnots > 0) {
      note += ' Reported, not hidden: this file also carries ' + info.otherAnnots + ' annotation' + (info.otherAnnots === 1 ? '' : 's') +
        ' that are not form fields (highlights, notes or similar). This tool cannot bake those into the page, so they remain annotations in the output.';
    }
    $('fl-achieved').textContent = note;
    result.classList.remove('hidden');
    const stamp = $('fl-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Flatten PDF', name: file.name, detail: fields + ' fields flattened' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
