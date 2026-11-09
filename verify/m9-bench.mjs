// Milestone 9 bench, step 3: run the @cantoo/pdf-lib fork's
// load-with-password + save round trip (exactly what the unlock page
// will do) over the qpdf-encrypted corpus and measure fidelity.
// Run: node verify/m9-bench.mjs
// Writes verify/m9-bench-results.json and prints the matrix.
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';

// Unlock flow B: after the password load, delete the source's own
// encryption dictionary object and any stale cross-reference stream
// objects the parser carried into the context, so the saved file
// contains no trace of the old protection anywhere (the naive save
// leaves both behind as orphans, and the fork's own parser resurrects
// /Encrypt from the stale xref stream's dictionary on reload).
function stripStaleProtectionObjects(doc) {
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    // The source's cross-reference stream object survives the parse
    // as an unparsed raw object whose bytes are its old dictionary
    // (which names /Encrypt). It is never content; drop it.
    if (obj && obj.constructor && obj.constructor.name === 'PDFInvalidObject' && obj.data) {
      const headBytes = obj.data.slice(0, 256);
      let head = '';
      for (let i = 0; i < headBytes.length; i++) head += String.fromCharCode(headBytes[i]);
      if (/\/Type\s*\/XRef/.test(head)) { ctx.delete(ref); continue; }
    }
    // NB: a PDFDict's own `.dict` property is its internal Map, so
    // the instanceof check must come before any `.dict` access.
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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const M9 = path.join(HERE, 'fixtures', 'm9');
const CORPUS = path.join(M9, 'corpus');
const OUT = path.join(M9, 'unlocked');
fs.mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'corpus.json'), 'utf8'));

function textOf(bytes) {
  const tmp = path.join(OUT, '.tmp.pdf');
  fs.writeFileSync(tmp, bytes);
  const out = execFileSync('pdftotext', [tmp, '-'], { encoding: 'utf8' });
  return out.replace(/\s+/g, ' ').trim();
}
function formValues(doc) {
  const vals = {};
  try {
    for (const f of doc.getForm().getFields()) {
      const name = f.getName();
      const ctor = f.constructor.name;
      if (ctor === 'PDFTextField') vals[name] = f.getText();
      else if (ctor === 'PDFCheckBox') vals[name] = f.isChecked();
      else if (ctor === 'PDFDropdown') vals[name] = f.getSelected();
      else vals[name] = ctor;
    }
  } catch (e) { /* no form */ }
  return vals;
}
function attachmentInfo(doc) {
  try {
    return doc.getAttachments().map((a) => a && (a.name || (a.fileName))).filter(Boolean).sort();
  } catch (e) { return ['<error:' + (e.message || e) + '>']; }
}
function sigCheck(file) {
  // Independent structural check with pikepdf: signature field
  // present, its value is a /Sig dictionary, ByteRange present.
  const py = `
import pikepdf, json, sys
p = pikepdf.open(${JSON.stringify(file)})
out = {"field": False, "sigdict": False, "byterange": False}
try:
    fields = p.Root.AcroForm.Fields
    for f in fields:
        if str(f.get("/FT", "")) == "/Sig":
            out["field"] = True
            v = f.get("/V", None)
            if v is not None and str(v.get("/Type", "")) == "/Sig":
                out["sigdict"] = True
                out["byterange"] = "/ByteRange" in v
except Exception as e:
    out["error"] = str(e)
print(json.dumps(out))`;
  const res = execFileSync('/tmp/qpdfvenv/bin/python', ['-c', py], { encoding: 'utf8' });
  return JSON.parse(res.trim());
}

// Reference measurements from the plaintext bases.
const baseInfo = {};
for (const base of ['text', 'form', 'attach', 'sig', 'big']) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(M9, `base-${base}.pdf`)));
  const doc = await PDFDocument.load(bytes);
  baseInfo[base] = {
    pages: doc.getPageCount(),
    text: textOf(bytes),
    form: formValues(doc),
    attachments: attachmentInfo(doc),
  };
}
baseInfo.sig.sig = sigCheck(path.join(M9, 'base-sig.pdf'));

const rows = [];
for (const c of manifest.cases) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(CORPUS, c.case + '.pdf')));
  const ref = baseInfo[c.base];
  const row = { case: c.case, base: c.base, algo: c.algo, R: c.R, cipher: c.cipher, kind: c.kind, checks: {} };
  // Negative controls.
  if (c.kind === 'open') {
    row.checks.noPasswordRefused = await PDFDocument.load(bytes).then(() => false).catch(() => true);
    row.checks.wrongPasswordRefused = await PDFDocument.load(bytes, { password: 'wrong-pw' }).then(() => false).catch(() => true);
  } else {
    row.checks.plainLoadBehaviour = await PDFDocument.load(bytes).then(() => 'loads').catch(() => 'refused');
  }
  // The unlock flow: load with the password the visitor would type
  // (open password), or the empty password (owner-only file).
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { password: c.password });
    row.checks.loadWithPassword = true;
  } catch (e) {
    row.checks.loadWithPassword = false;
    row.error = String(e && e.message ? e.message : e).slice(0, 200);
    rows.push(row);
    continue;
  }
  // Record the naive save's behaviour for the record (flow A), then
  // run the shipped flow B on a fresh load.
  const naive = await doc.save();
  row.naiveSaveReloadsClean = await PDFDocument.load(naive).then(() => true).catch(() => false);
  doc = await PDFDocument.load(bytes, { password: c.password });
  stripStaleProtectionObjects(doc);
  const saved = await doc.save();
  row.checks.noStaleEncryptString = !Buffer.from(saved).toString('latin1').includes('/Encrypt');
  fs.writeFileSync(path.join(OUT, c.case + '.pdf'), saved);
  // The output must open with no password and carry no encryption.
  let out;
  try {
    out = await PDFDocument.load(saved);
    row.checks.outputOpensClean = true;
    row.checks.outputNotEncrypted = out.isEncrypted === false;
  } catch (e) {
    row.checks.outputOpensClean = false;
    row.error = 'output reload: ' + String(e && e.message ? e.message : e).slice(0, 160);
    rows.push(row);
    continue;
  }
  row.checks.pages = out.getPageCount() === ref.pages;
  row.checks.textEqual = textOf(saved) === ref.text;
  if (c.base === 'form') row.checks.formValues = JSON.stringify(formValues(out)) === JSON.stringify(ref.form);
  if (c.base === 'attach') row.checks.attachments = JSON.stringify(attachmentInfo(out)) === JSON.stringify(ref.attachments);
  if (c.base === 'sig') {
    const s = sigCheck(path.join(OUT, c.case + '.pdf'));
    row.checks.sigStructure = s.field && s.sigdict && s.byterange;
    row.sigDetail = s;
  }
  rows.push(row);
}

const keys = ['loadWithPassword', 'outputOpensClean', 'outputNotEncrypted', 'pages', 'textEqual', 'formValues', 'attachments', 'sigStructure', 'noPasswordRefused', 'wrongPasswordRefused'];
console.log('case'.padEnd(38), keys.map((k) => k.slice(0, 5)).join(' '));
let pass = 0;
for (const r of rows) {
  const cells = keys.map((k) => {
    const v = r.checks[k];
    if (v === undefined) return '  .  ';
    return v ? '  ✓  ' : '  ✗  ';
  });
  const allOk = keys.every((k) => r.checks[k] === undefined || r.checks[k] === true);
  if (allOk) pass++;
  console.log(r.case.padEnd(38), cells.join(' '), allOk ? '' : '  <-- ' + (r.error || 'see checks'));
}
console.log(`\n${pass}/${rows.length} cases pass every applicable check`);
fs.writeFileSync(path.join(HERE, 'm9-bench-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: rows.length, baseInfo: Object.fromEntries(Object.entries(baseInfo).map(([k, v]) => [k, { pages: v.pages, form: v.form, attachments: v.attachments, sig: v.sig }])), rows }, null, 1));
