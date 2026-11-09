// Milestone 13 bench: which organise engine survives the nasty
// fixtures? Candidates:
//  A copyAll       — copyPages into a brand-new document.
//  B extractMerge  — delete-extract each wanted page on its own
//                    (the split tool's proven pattern), then merge
//                    the singles with copyPages.
//  G surgery       — stay inside the original document: materialise
//                    inherited page-tree attributes onto each page,
//                    copy only the duplicate slots, rebuild the root
//                    page tree's Kids in the new order.
// Checks per output: page order by marker text (pdftotext), picture
// reachability through the INHERITANCE chain (what a renderer sees),
// form field values, the outline item's destination page, and the
// document's stored details. Plus the metadata tool's two moves
// (strip everything; set title/author) read back independently.
// Run: node verify/m13-bench.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = path.join(HERE, 'fixtures', 'm13');
const TMP = path.join(HERE, 'fixtures', 'm13', 'bench-out');
fs.mkdirSync(TMP, { recursive: true });

const pageText = (file, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), file, '-'], { encoding: 'utf8' });

// ---------- candidate A: copyPages into a new document --------------
async function organiseCopyAll(srcBytes, order) {
  const src = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, order);
  for (const p of pages) out.addPage(p);
  return out.save();
}

// ---------- candidate B: delete-extract singles, then merge --------
async function extractOne(srcBytes, idx, total) {
  const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  for (let i = total - 1; i >= 0; i--) if (i !== idx) doc.removePage(i);
  return doc.save();
}
async function organiseExtractMerge(srcBytes, order) {
  const probe = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const total = probe.getPageCount();
  const out = await PDFDocument.create();
  for (const idx of order) {
    const single = await PDFDocument.load(await extractOne(srcBytes, idx, total), { updateMetadata: false });
    const [p] = await out.copyPages(single, [0]);
    out.addPage(p);
  }
  return out.save();
}

// ---------- candidate G: in-document surgery -------------------------
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
function materialise(doc, page) {
  const leaf = page.node;
  const chain = [leaf];
  let node = leaf.lookup(PDFName.of('Parent'));
  while (node && typeof node.get === 'function') { chain.push(node); node = node.lookup(PDFName.of('Parent')); }
  for (const key of INHERITABLE) {
    const name = PDFName.of(key);
    if (leaf.get(name)) continue;
    for (let i = 1; i < chain.length; i++) {
      const raw = chain[i].get(name);
      if (raw) { leaf.set(name, raw); break; }
    }
  }
}
async function organiseSurgery(srcBytes, order) {
  const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const pages = doc.getPages();
  for (const p of pages) materialise(doc, p);
  const seen = new Set();
  const extras = [];
  order.forEach((idx, slot) => { if (seen.has(idx)) extras.push({ idx, slot }); else seen.add(idx); });
  const copyBySlot = {};
  if (extras.length) {
    const copies = await doc.copyPages(doc, extras.map((e) => e.idx));
    extras.forEach((e, k) => { copyBySlot[e.slot] = copies[k]; });
  }
  const leafFor = (slot, idx) => copyBySlot[slot] || pages[idx];
  const root = doc.catalog.Pages();
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const kids = doc.context.obj(order.map((idx, slot) => leafFor(slot, idx).ref));
  root.set(PDFName.of('Kids'), kids);
  root.set(PDFName.of('Count'), PDFNumber.of(order.length));
  order.forEach((idx, slot) => leafFor(slot, idx).node.set(PDFName.of('Parent'), rootRef));
  doc.pageCount = order.length;
  if (doc.pageCache && doc.pageCache.invalidate) doc.pageCache.invalidate();
  return doc.save();
}

// ---------- checks ----------------------------------------------------
function effectiveResources(doc, page) {
  let node = page.node;
  while (node && typeof node.get === 'function') {
    const raw = node.get(PDFName.of('Resources'));
    if (raw) return doc.context.lookup(raw);
    node = node.lookup(PDFName.of('Parent'));
  }
  return null;
}
function pageHasImage(doc, page) {
  const res = effectiveResources(doc, page);
  if (!res) return false;
  let xo = null;
  try { xo = res.lookup(PDFName.of('XObject')); } catch (e) { xo = null; }
  if (!xo || typeof xo.entries !== 'function') return false;
  for (const [, ref] of xo.entries()) {
    const obj = doc.context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      const st = obj.dict.lookup(PDFName.of('Subtype'));
      if (st && st.toString() === '/Image') return true;
    }
  }
  return false;
}
function outlineDestIndex(doc) {
  try {
    const catalog = doc.context.lookup(doc.context.trailerInfo.Root);
    const outlines = catalog.lookup(PDFName.of('Outlines'));
    if (!outlines) return 'absent';
    const item = outlines.lookup(PDFName.of('First'));
    if (!item) return 'absent';
    const dest = item.lookup(PDFName.of('Dest'));
    if (!dest || typeof dest.get !== 'function') return 'absent';
    const ref = dest.get(0);
    const idx = doc.getPages().findIndex((p) => p.ref.toString() === String(ref));
    return idx;
  } catch (e) { return 'error: ' + e.message; }
}
async function check(label, bytes, expect) {
  const file = path.join(TMP, label + '.pdf');
  fs.writeFileSync(file, bytes);
  const r = { label };
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    r.pages = doc.getPageCount();
    r.markers = [];
    for (let n = 1; n <= r.pages; n++) {
      const t = pageText(file, n);
      const m = t.match(/MARKER-[A-Z]+-P\d|PAGE-[A-Z]+/);
      r.markers.push(m ? m[0] : '(none)');
    }
    r.orderOk = JSON.stringify(r.markers) === JSON.stringify(expect.markers);
    r.images = doc.getPages().map((p) => pageHasImage(doc, p));
    r.imagesOk = JSON.stringify(r.images) === JSON.stringify(expect.images);
    r.outline = outlineDestIndex(doc);
    r.outlineOk = String(r.outline) === String(expect.outline);
    r.title = doc.getTitle();
    r.titleOk = r.title === expect.title;
    if (expect.form) {
      try {
        const form = doc.getForm();
        r.form = {
          fullname: form.getTextField('fullname').getText(),
          subscribe: form.getCheckBox('subscribe').isChecked(),
          plan: form.getDropdown('plan').getSelected(),
        };
        r.formOk = JSON.stringify(r.form) === JSON.stringify(expect.form);
      } catch (e) { r.form = 'error: ' + e.message; r.formOk = false; }
    }
  } catch (e) { r.fatal = e.message; }
  console.log(JSON.stringify(r));
  return r;
}

// ---------- run -------------------------------------------------------
const sharedOrder = [2, 0, 0, 3];
const sharedExpect = {
  markers: ['MARKER-SHARED-P3', 'MARKER-SHARED-P1', 'MARKER-SHARED-P1', 'MARKER-SHARED-P4'],
  images: [true, true, true, true],
  outline: 0,
  title: 'Shared Fixture Title',
};
const formsOrder = [2, 0, 0];
const formsExpect = {
  markers: ['MARKER-FORM-P3', 'MARKER-FORM-P1', 'MARKER-FORM-P1'],
  images: [false, false, false],
  outline: 'absent',
  title: 'Forms Fixture Title',
  form: { fullname: 'Ada Lovelace', subscribe: true, plan: ['Standard'] },
};
const imagesOrder = [2, 0, 0, 3];
const imagesExpect = {
  markers: ['PAGE-THREE', 'PAGE-ONE', 'PAGE-ONE', 'PAGE-FOUR'],
  images: [true, true, true, true],
  outline: 'absent',
  title: 'Images Fixture',
};

const engines = { A: organiseCopyAll, B: organiseExtractMerge, G: organiseSurgery };
const cases = [
  ['shared-root', sharedOrder, sharedExpect],
  ['shared-mid', sharedOrder, sharedExpect],
  ['forms', formsOrder, formsExpect],
  ['images-markers', imagesOrder, imagesExpect],
];
const summary = {};
for (const [name, order, expect] of cases) {
  const src = fs.readFileSync(path.join(F, name + '.pdf'));
  for (const [key, fn] of Object.entries(engines)) {
    try {
      const out = await fn(src, order);
      const r = await check(key + '-' + name, out, expect);
      const pass = r.orderOk && r.imagesOk && r.outlineOk && r.titleOk && (expect.form ? r.formOk : true);
      summary[key + '-' + name] = pass ? 'PASS' : 'FAIL';
    } catch (e) {
      console.log(JSON.stringify({ label: key + '-' + name, fatal: e.message }));
      summary[key + '-' + name] = 'ERROR';
    }
  }
}
console.log('SUMMARY', JSON.stringify(summary, null, 1));

// ---------- metadata moves ---------------------------------------------
{
  const src = fs.readFileSync(path.join(F, 'meta.pdf'));
  // Strip: clear the info dictionary's keys; drop the XMP stream ref.
  const doc = await PDFDocument.load(src, { updateMetadata: false });
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : null;
  const keys = info ? [...info.keys()].map((k) => k.toString()) : [];
  if (info) for (const k of [...info.keys()]) info.delete(k);
  const hadXmp = !!doc.catalog.get(PDFName.of('Metadata'));
  if (hadXmp) doc.catalog.delete(PDFName.of('Metadata'));
  const stripped = await doc.save();
  const f1 = path.join(TMP, 'meta-stripped.pdf');
  fs.writeFileSync(f1, stripped);
  const back = await PDFDocument.load(stripped, { updateMetadata: false });
  const backInfo = back.context.trailerInfo.Info ? back.context.lookup(back.context.trailerInfo.Info) : null;
  const backKeys = backInfo ? [...backInfo.keys()].map((k) => k.toString()) : [];
  const pdfinfo = execFileSync('pdfinfo', [f1], { encoding: 'utf8' });
  console.log('META STRIP', JSON.stringify({
    keysBefore: keys, xmpBefore: hadXmp, keysAfter: backKeys,
    gettersAfter: {
      title: back.getTitle(), author: back.getAuthor(), subject: back.getSubject(),
      keywords: back.getKeywords(), creator: back.getCreator(), producer: back.getProducer(),
      created: back.getCreationDate(), modified: back.getModificationDate(),
    },
    pdfinfoLeaks: /Quarterly|Jo Example|Bench (Creator|Producer)|Board papers/.test(pdfinfo),
    pages: back.getPageCount(),
  }));
  // Set: new title/author on a fresh load.
  const doc2 = await PDFDocument.load(src, { updateMetadata: false });
  doc2.setTitle('A Brand New Title');
  doc2.setAuthor('A New Author');
  const edited = await doc2.save();
  const back2 = await PDFDocument.load(edited, { updateMetadata: false });
  console.log('META SET', JSON.stringify({ title: back2.getTitle(), author: back2.getAuthor(), subjectKept: back2.getSubject() }));
}
