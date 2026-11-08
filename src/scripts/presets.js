// Preset gallery: one click saves a starter chain into the browser's
// chain storage (the same storage the workflows bench reads), then the
// visitor follows the link and runs it. Saving is idempotent: a chain
// with the same id is never duplicated.
import { getChains, addChain } from './workbench.js';
import { STARTER_CHAINS } from './lib/chains.js';

document.querySelectorAll('[data-preset]').forEach((btn) => {
  const starter = STARTER_CHAINS.find((c) => c.id === btn.dataset.preset);
  const note = document.querySelector('[data-preset-note="' + btn.dataset.preset + '"]');
  if (!starter) return;
  if (getChains().some((c) => c.id === starter.id) && note) {
    note.textContent = 'Saved in this browser. Open the workflows bench to run it.';
  }
  btn.addEventListener('click', () => {
    if (!getChains().some((c) => c.id === starter.id)) addChain(starter);
    if (note) note.textContent = 'Saved in this browser. Now open the workflows bench, drop your files, and run it.';
    btn.textContent = 'Saved. Open the workflows bench';
    btn.setAttribute('href', '/workflows/');
  });
});
