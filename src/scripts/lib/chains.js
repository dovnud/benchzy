// Workflow chains: the shared definitions for the workflows bench and
// the preset gallery. A chain is a named list of steps; every step
// carries the full key set (normalizeStep in workbench.js), with null
// for the parameters its tool does not use. The step tools are the
// measured engines run in sequence: merge, compress-pdf (to a target),
// split (a page range), stamp (a line of text on every page),
// compress-image (to a target), remove-bg (the flagship cutout engine)
// and ocr (the reading engine). Nothing here is a new engine.
//
// Two rules shape what the builder offers, and the workflows page
// prints both in its own words:
// - A chain works on ONE kind of file. The pdf steps and the image
//   steps are kept apart (kind below): handed the other kind, a step
//   would pass every file through untouched and print a step that did
//   nothing. A stray file of the other kind on the tray still passes
//   through at run time, logged per file, as chains have always done.
// - Read the words (OCR) takes either kind (kind 'any') and is always
//   the last step: what it hands on is text, not a file, so no step
//   can come after it (endsWithText).

export const STEP_TOOLS = [
  { id: 'merge', label: 'Merge all PDFs into one', kind: 'pdf' },
  { id: 'compress-pdf', label: 'Compress PDF to a target size', kind: 'pdf' },
  { id: 'split', label: 'Split PDF to a page range', kind: 'pdf' },
  { id: 'stamp', label: 'Stamp a line of text on every PDF page', kind: 'pdf' },
  { id: 'compress-image', label: 'Compress image to a target size', kind: 'image' },
  { id: 'remove-bg', label: 'Remove the background (photo in, see-through PNG out)', kind: 'image' },
  { id: 'ocr', label: 'Read the words (OCR) — ends the chain with text', kind: 'any', endsWithText: true },
];

export function stepTool(id) {
  return STEP_TOOLS.find((t) => t.id === id) || null;
}

// The kind of file a chain works on, set by its first step that has
// one: 'pdf', 'image', or null (no steps yet, or only the OCR step,
// which takes either kind and ends the chain anyway).
export function chainKind(steps) {
  for (const s of steps || []) {
    const t = stepTool(s.tool);
    if (t && (t.kind === 'pdf' || t.kind === 'image')) return t.kind;
  }
  return null;
}

export function describeStep(step) {
  switch (step.tool) {
    case 'merge': return 'Merge all PDFs into one';
    case 'compress-pdf': return 'Compress PDF to ' + (step.targetKB || 500) + ' KB';
    case 'split': return 'Take pages ' + (step.fromPage || 1) + ' to ' + (step.toPage || 'end');
    case 'stamp': return 'Stamp "' + (step.text || 'PAID') + '" on every page';
    case 'compress-image': return 'Compress image to ' + (step.targetKB || 200) + ' KB';
    case 'remove-bg': return 'Remove the background';
    case 'ocr': return 'Read the words (OCR) → text';
    default: return step.tool;
  }
}

// Starter chains: the named packs the suites sell as workflows, here as
// one-click saved chains. Ids are stable so the preset gallery and the
// workflows page add the same chain, once.
export const STARTER_CHAINS = [
  {
    id: 'starter-invoice-pack',
    name: 'Invoice pack',
    steps: [
      { tool: 'merge', targetKB: null, fromPage: null, toPage: null, text: null },
      { tool: 'compress-pdf', targetKB: 500, fromPage: null, toPage: null, text: null },
    ],
  },
  {
    id: 'starter-portal-pack',
    name: 'Portal pack',
    steps: [
      { tool: 'compress-pdf', targetKB: 200, fromPage: null, toPage: null, text: null },
    ],
  },
  {
    id: 'starter-paid-pack',
    name: 'Paid pack',
    steps: [
      { tool: 'merge', targetKB: null, fromPage: null, toPage: null, text: null },
      { tool: 'stamp', targetKB: null, fromPage: null, toPage: null, text: 'PAID IN FULL' },
      { tool: 'compress-pdf', targetKB: 500, fromPage: null, toPage: null, text: null },
    ],
  },
  {
    id: 'starter-seller-photos',
    name: 'Seller photos',
    steps: [
      { tool: 'compress-image', targetKB: 200, fromPage: null, toPage: null, text: null },
    ],
  },
  {
    id: 'starter-seller-cutouts',
    name: 'Seller cutouts',
    steps: [
      { tool: 'remove-bg', targetKB: null, fromPage: null, toPage: null, text: null },
      { tool: 'compress-image', targetKB: 50, fromPage: null, toPage: null, text: null },
    ],
  },
  {
    id: 'starter-receipt-words',
    name: 'Receipt words',
    steps: [
      { tool: 'ocr', targetKB: null, fromPage: null, toPage: null, text: null },
    ],
  },
];
