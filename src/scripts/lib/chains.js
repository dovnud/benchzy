// Workflow chains: the shared definitions for the workflows bench and
// the preset gallery. A chain is a named list of steps; every step
// carries the full key set (normalizeStep in workbench.js), with null
// for the parameters its tool does not use. The step tools are the
// measured engines run in sequence: merge, compress-pdf (to a target),
// split (a page range), stamp (a line of text on every page) and
// compress-image (to a target). Nothing here is a new engine.

export const STEP_TOOLS = [
  { id: 'merge', label: 'Merge all PDFs into one' },
  { id: 'compress-pdf', label: 'Compress PDF to a target size' },
  { id: 'split', label: 'Split PDF to a page range' },
  { id: 'stamp', label: 'Stamp a line of text on every PDF page' },
  { id: 'compress-image', label: 'Compress image to a target size' },
];

export function describeStep(step) {
  switch (step.tool) {
    case 'merge': return 'Merge all PDFs into one';
    case 'compress-pdf': return 'Compress PDF to ' + (step.targetKB || 500) + ' KB';
    case 'split': return 'Take pages ' + (step.fromPage || 1) + ' to ' + (step.toPage || 'end');
    case 'stamp': return 'Stamp "' + (step.text || 'PAID') + '" on every page';
    case 'compress-image': return 'Compress image to ' + (step.targetKB || 200) + ' KB';
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
];
