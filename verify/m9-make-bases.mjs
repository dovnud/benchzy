// Milestone 9 bench, step 1: the plaintext base files the encrypted
// corpus is built from. Run: node verify/m9-make-bases.mjs
// Bases: text (3 marked pages), form (filled fields), attachments,
// a signature-field file carrying a signature dictionary, and a
// 300-page file. Encryption is NOT done here: pikepdf (real qpdf)
// encrypts them in m9-encrypt-corpus.py, independently of the fork.
import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber } from '@cantoo/pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(new URL('.', import.meta.url).pathname, 'fixtures', 'm9');
fs.mkdirSync(OUT, { recursive: true });

// --- base-text.pdf: 3 pages, unique marker text per page ---
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`M9 TEXT PAGE ${i}`, { x: 50, y: 730, size: 16, font });
    page.drawText(`Unique line for page ${i}: benchzy fidelity bench.`, { x: 50, y: 700, size: 11, font });
    page.drawText('The quick brown fox jumps over the lazy dog 0123456789.', { x: 50, y: 676, size: 11, font });
  }
  fs.writeFileSync(path.join(OUT, 'base-text.pdf'), await doc.save());
}

// --- base-form.pdf: filled text field, checked box, chosen dropdown ---
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('M9 FORM BASE', { x: 50, y: 730, size: 14, font });
  const form = doc.getForm();
  const nameField = form.createTextField('fullname');
  nameField.addToPage(page, { x: 50, y: 682, width: 260, height: 20 });
  nameField.setText('Grace Hopper');
  const sub = form.createCheckBox('subscribe');
  sub.addToPage(page, { x: 50, y: 634, width: 16, height: 16 });
  sub.check();
  const plan = form.createDropdown('plan');
  plan.addOptions(['Basic', 'Standard', 'Pro']);
  plan.addToPage(page, { x: 50, y: 582, width: 160, height: 20 });
  plan.select('Pro');
  form.updateFieldAppearances();
  fs.writeFileSync(path.join(OUT, 'base-form.pdf'), await doc.save());
}

// --- base-attach.pdf: one page + an embedded text attachment ---
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('M9 ATTACHMENT BASE', { x: 50, y: 730, size: 14, font });
  await doc.attach(new TextEncoder().encode('M9 ATTACHMENT BODY 12345'), 'm9-notes.txt', {
    mimeType: 'text/plain',
    description: 'Bench attachment',
    creationDate: new Date('2026-11-08T00:00:00Z'),
    modificationDate: new Date('2026-11-08T00:00:00Z'),
  });
  fs.writeFileSync(path.join(OUT, 'base-attach.pdf'), await doc.save());
}

// --- base-sig.pdf: an (unsigned-by-crypto) signature FIELD carrying a
// signature dictionary with ByteRange/Contents, i.e. the structure a
// signed file presents to a parser. Recorded honestly: the signature
// bytes are placeholders, not a valid CMS signature; the bench asks
// whether load+save preserves the structure and the file still opens.
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('M9 SIGNATURE STRUCTURE BASE', { x: 50, y: 730, size: 14, font });
  const ctx = doc.context;
  const sigDict = ctx.flateStream(new Uint8Array(0), {
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 0, 0, 0],
    Contents: PDFHexString.of('00'.repeat(64)),
    Name: PDFString.of('Bench Signer'),
    M: PDFString.of("D:20261108000000Z"),
  });
  const sigRef = ctx.register(sigDict);
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('Signature1'),
    V: sigRef,
    Rect: [50, 620, 250, 660],
    P: page.ref,
    F: 4,
  });
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);
  const form = doc.getForm();
  const acro = form.acroForm.dict;
  const fields = acro.lookup(PDFName.of('Fields'), PDFArray);
  fields.push(widgetRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  void PDFArray; void PDFNumber;
  fs.writeFileSync(path.join(OUT, 'base-sig.pdf'), await doc.save());
}

// --- base-big.pdf: 300 pages ---
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 300; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`M9 BIG PAGE ${i} OF 300`, { x: 50, y: 730, size: 12, font });
  }
  fs.writeFileSync(path.join(OUT, 'base-big.pdf'), await doc.save());
}

console.log('bases written to', OUT);
