// Milestone 13 fixtures: the files the organise bench and the
// browser gates are proved against.
// - shared-root.pdf / shared-mid.pdf (hand-built): four pages whose
//   font and picture live in a Resources dict on the PAGE TREE (root
//   node, or one intermediate node), never on the pages themselves —
//   the shape that makes naive page copying drop the pictures. Each
//   page carries a marker line. The catalog carries an outline whose
//   item points at page 3; the trailer Info carries known details.
// - forms.pdf (pdf-lib): three pages, one filled form field each
//   (text, checkbox, dropdown), a marker line per page.
// - images-markers.pdf (pdf-lib): four pages, each with a stored
//   picture AND a marker line (PAGE-ONE .. PAGE-FOUR) — the browser
//   gate's organise fixture.
// - meta.pdf (pdf-lib): every info field set to a known value, with
//   known creation/modification dates.
// Regenerate with: node verify/m13-make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'm13');
fs.mkdirSync(OUT, { recursive: true });
const M11 = path.join(HERE, 'fixtures', 'm11');
const jpgBytes = fs.readFileSync(path.join(M11, 'photo.jpg'));
const jpgMeta = await sharp(jpgBytes).metadata();

// --- tiny PDF writer (after m12's), with an Info ref in the trailer --
function buildPdf(objects, infoRef) {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [0];
  let pos = parts[0].length;
  objects.forEach((body, i) => {
    const head = Buffer.from((i + 1) + ' 0 obj\n', 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(pos);
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xrefPos = pos;
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  const trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R' + (infoRef ? ' /Info ' + infoRef + ' 0 R' : '') + ' >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
  return Buffer.concat([...parts, Buffer.from(xref + trailer, 'latin1')]);
}
function streamObj(dict, data) {
  return Buffer.concat([
    Buffer.from('<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n', 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

function sharedFixture(where) {
  // Refs: 1 catalog, 2 root Pages, 3 mid Pages (mid variant only),
  // 4-7 leaves, 8-11 contents, 12 font, 13 image, 14 outlines,
  // 15 outline item, 16 info.
  const leafRefs = [4, 5, 6, 7];
  const contentRefs = [8, 9, 10, 11];
  const parentRef = where === 'mid' ? 3 : 2;
  const resDict = '/Resources << /Font << /F1 12 0 R >> /XObject << /Im1 13 0 R >> >>';
  const objects = [];
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R /Outlines 14 0 R >>');
  objects[1] = where === 'mid'
    ? Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 4 >>')
    : Buffer.from(`<< /Type /Pages /Kids [${leafRefs.join(' 0 R ')} 0 R] /Count 4 ${resDict} >>`);
  if (where === 'mid') {
    objects[2] = Buffer.from(`<< /Type /Pages /Parent 2 0 R /Kids [${leafRefs.join(' 0 R ')} 0 R] /Count 4 ${resDict} >>`);
  }
  leafRefs.forEach((ref, i) => {
    objects[ref - 1] = Buffer.from(`<< /Type /Page /Parent ${parentRef} 0 R /MediaBox [0 0 320 240] /Contents ${contentRefs[i]} 0 R >>`);
  });
  contentRefs.forEach((ref, i) => {
    const text = `q 200 0 0 150 20 90 cm /Im1 Do Q\nBT /F1 20 Tf 20 40 Td (MARKER-SHARED-P${i + 1}) Tj ET`;
    objects[ref - 1] = streamObj('', Buffer.from(text, 'latin1'));
  });
  objects[11] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects[12] = streamObj(`/Type /XObject /Subtype /Image /Width ${jpgMeta.width} /Height ${jpgMeta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpgBytes);
  objects[13] = Buffer.from('<< /Type /Outlines /First 15 0 R /Last 15 0 R /Count 1 >>');
  objects[14] = Buffer.from(`<< /Title (Chapter three) /Parent 14 0 R /Dest [${leafRefs[2]} 0 R /XYZ 0 240 0] >>`);
  objects[15] = Buffer.from('<< /Title (Shared Fixture Title) /Author (Fixture Author) /Creator (Fixture Creator) >>');
  // Object 3 is unused in the root variant; fill it with a null-ish
  // placeholder comment object so numbering stays aligned.
  if (where === 'root') objects[2] = Buffer.from('<< /BenchzyFixture (shared resources on the root page-tree node) >>');
  const bytes = buildPdf(objects, 16);
  const name = where === 'mid' ? 'shared-mid.pdf' : 'shared-root.pdf';
  fs.writeFileSync(path.join(OUT, name), bytes);
  console.log(name, 'ready (4 pages, resources on the', where, 'page-tree node, outline -> page 3)');
}
sharedFixture('root');
sharedFixture('mid');

// --- forms.pdf -------------------------------------------------------
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const mk = (n) => {
    const p = doc.addPage([612, 792]);
    p.drawText('MARKER-FORM-P' + n, { x: 50, y: 740, size: 16, font });
    return p;
  };
  const p1 = mk(1);
  p1.drawText('Full name:', { x: 50, y: 690, size: 11, font });
  const name = form.createTextField('fullname');
  name.addToPage(p1, { x: 130, y: 682, width: 260, height: 20, textColor: undefined, font });
  name.setText('Ada Lovelace');
  const p2 = mk(2);
  p2.drawText('Subscribe:', { x: 50, y: 640, size: 11, font });
  const sub = form.createCheckBox('subscribe');
  sub.addToPage(p2, { x: 130, y: 634, width: 16, height: 16 });
  sub.check();
  const p3 = mk(3);
  p3.drawText('Plan:', { x: 50, y: 590, size: 11, font });
  const plan = form.createDropdown('plan');
  plan.addOptions(['Basic', 'Standard', 'Pro']);
  plan.addToPage(p3, { x: 130, y: 582, width: 160, height: 20, font });
  plan.select('Standard');
  form.updateFieldAppearances();
  doc.setTitle('Forms Fixture Title');
  doc.setAuthor('Form Author');
  fs.writeFileSync(path.join(OUT, 'forms.pdf'), await doc.save());
  console.log('forms.pdf ready (3 pages, text + checkbox + dropdown filled)');
}

// --- images-markers.pdf ----------------------------------------------
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(jpgBytes);
  const alpha = await doc.embedPng(fs.readFileSync(path.join(M11, 'alpha.png')));
  const opaque = await doc.embedPng(fs.readFileSync(path.join(M11, 'opaque.png')));
  const words = ['PAGE-ONE', 'PAGE-TWO', 'PAGE-THREE', 'PAGE-FOUR'];
  const pics = [jpg, alpha, opaque, jpg];
  for (let i = 0; i < 4; i++) {
    const p = doc.addPage([640, 480]);
    p.drawImage(pics[i], { x: 160, y: 120, width: 320, height: 240 });
    p.drawText(words[i], { x: 30, y: 430, size: 28, font });
  }
  doc.setTitle('Images Fixture');
  fs.writeFileSync(path.join(OUT, 'images-markers.pdf'), await doc.save());
  console.log('images-markers.pdf ready (4 pages, picture + marker each)');
}

// --- meta.pdf ----------------------------------------------------------
// Two passes: pdf-lib stamps its own producer and modification date
// when saving a created document, so the known values are set on a
// re-loaded copy saved with updateMetadata off.
{
  let doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('MARKER-META-P1', { x: 50, y: 740, size: 16, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('MARKER-META-P2', { x: 50, y: 740, size: 16, font });
  const pass1 = await doc.save();
  doc = await PDFDocument.load(pass1, { updateMetadata: false });
  doc.setTitle('Quarterly Report (Final)');
  doc.setAuthor('Jo Example');
  doc.setSubject('Board papers');
  doc.setKeywords(['alpha', 'beta', 'gamma']);
  doc.setCreator('Bench Creator 1.0');
  doc.setProducer('Bench Producer 2.0');
  doc.setCreationDate(new Date(Date.UTC(2025, 0, 15, 10, 30, 0)));
  doc.setModificationDate(new Date(Date.UTC(2025, 5, 20, 8, 15, 0)));
  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT, 'meta.pdf'), bytes);
  const check = await PDFDocument.load(bytes, { updateMetadata: false });
  console.log('meta.pdf ready; read-back:', JSON.stringify({
    title: check.getTitle(), author: check.getAuthor(), subject: check.getSubject(),
    keywords: check.getKeywords(), creator: check.getCreator(), producer: check.getProducer(),
    created: check.getCreationDate(), modified: check.getModificationDate(),
  }));
}
