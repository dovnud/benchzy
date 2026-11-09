// Organise core: rebuild a PDF's page order inside the document
// itself — no page is copied into a new file, so nothing about the
// pages is re-encoded or left behind. Proved in verify/m13-bench.mjs
// against the fixtures that break the other approaches (page-tree
// shared resources, a filled form, an outline, stored details):
// copyPages into a fresh document loses the outline, the stored
// details and the form's field registrations on those fixtures;
// delete-extract + merge loses the same. This approach passes all
// of them, because the document is never rebuilt — only the order
// of its page list changes.
//
// How it works:
// 1. Pages can inherit their resources, page box and turn from the
//    page-tree nodes above them. Before any page moves, whatever a
//    page inherits is written onto the page itself, so the page
//    carries everything it needs wherever it lands.
// 2. Only true duplicates are copied (within the same document,
//    after step 1, so a copy is self-contained too).
// 3. The root page tree's page list is rewritten in the new order.
//    Kept pages keep their identity, so bookmarks, form fields and
//    links that point at them still point at them. A removed page's
//    contents stay in the file's storage, unlisted — the file stays
//    valid, at the price of not shrinking when a page is removed.
import { PDFName, PDFNumber } from '@cantoo/pdf-lib';

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// Write whatever this page inherits from its page-tree ancestors
// onto the page itself (only the entries the page lacks).
export function materialiseInherited(doc, page) {
  const leaf = page.node;
  const chain = [leaf];
  let node = leaf.lookup(PDFName.of('Parent'));
  while (node && typeof node.get === 'function') {
    chain.push(node);
    node = node.lookup(PDFName.of('Parent'));
  }
  for (const key of INHERITABLE) {
    const name = PDFName.of(key);
    if (leaf.get(name)) continue;
    for (let i = 1; i < chain.length; i++) {
      const raw = chain[i].get(name);
      if (raw) { leaf.set(name, raw); break; }
    }
  }
}

// order: the source page index (0-based) for every output slot, in
// output order; an index may repeat (a duplicated page) and may be
// absent (a removed page). At least one slot is required.
export async function organiseDocument(doc, order) {
  const pages = doc.getPages();
  for (const p of pages) materialiseInherited(doc, p);
  const seen = new Set();
  const extras = [];
  order.forEach((idx, slot) => {
    if (seen.has(idx)) extras.push({ idx, slot });
    else seen.add(idx);
  });
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
  order.forEach((idx, slot) => {
    leafFor(slot, idx).node.set(PDFName.of('Parent'), rootRef);
  });
  // The document caches its page list and count; both are now stale.
  doc.pageCount = order.length;
  if (doc.pageCache && doc.pageCache.invalidate) doc.pageCache.invalidate();
  return doc;
}
