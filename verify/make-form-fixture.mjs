// Builds the flatten test fixture: a PDF with a filled text field, a
// checked checkbox and a chosen dropdown, values set, appearances
// updated. Run: node verify/make-form-fixture.mjs
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(new URL('.', import.meta.url).pathname, 'fixtures', 'form-fixture.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText('Fixture form: flatten test', { x: 50, y: 730, size: 14, font });
page.drawText('Full name:', { x: 50, y: 690, size: 11, font });
page.drawText('Subscribe:', { x: 50, y: 640, size: 11, font });
page.drawText('Plan:', { x: 50, y: 590, size: 11, font });

const form = doc.getForm();
const nameField = form.createTextField('fullname');
nameField.addToPage(page, { x: 130, y: 682, width: 260, height: 20 });
nameField.setText('Ada Lovelace');
const sub = form.createCheckBox('subscribe');
sub.addToPage(page, { x: 130, y: 634, width: 16, height: 16 });
sub.check();
const plan = form.createDropdown('plan');
plan.addOptions(['Basic', 'Standard', 'Pro']);
plan.addToPage(page, { x: 130, y: 582, width: 160, height: 20 });
plan.select('Standard');
form.updateFieldAppearances();

fs.writeFileSync(out, await doc.save());
console.log('wrote', out);
