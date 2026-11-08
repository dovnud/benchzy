// Shared helpers for the Benchzy tool islands.
// The workbench lives in the visitor's own browser storage: job notes and
// saved settings only. Files themselves are never stored or sent anywhere.

export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

const JOBS_KEY = 'benchzy-jobs';
const PRESET_KEY = 'benchzy-presets';

export function recordJob(job) {
  try {
    const arr = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
    arr.unshift({ ...job, when: Date.now() });
    localStorage.setItem(JOBS_KEY, JSON.stringify(arr.slice(0, 12)));
  } catch (e) { /* storage unavailable: the job still worked */ }
}

export function getJobs() {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); } catch (e) { return []; }
}

export function clearJobs() {
  try { localStorage.removeItem(JOBS_KEY); } catch (e) {}
}

export function savePreset(tool, preset) {
  try {
    const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    all[tool] = preset;
    localStorage.setItem(PRESET_KEY, JSON.stringify(all));
  } catch (e) {}
}

export function getPreset(tool) {
  try {
    const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    return all[tool] || null;
  } catch (e) { return null; }
}

export function renderJobs(listEl, emptyEl) {
  const jobs = getJobs();
  if (!listEl) return;
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = jobs.length ? 'none' : 'block';
  for (const j of jobs) {
    const li = document.createElement('li');
    li.className = 'spec-row';
    const d = new Date(j.when);
    const when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = '';
    const left = document.createElement('span');
    left.textContent = j.tool + ' · ' + j.name;
    const right = document.createElement('span');
    right.textContent = (j.detail || '') + ' · ' + when;
    li.append(left, right);
    listEl.appendChild(li);
  }
}

// Saved workflow chains (milestone 6, ticket T7). A chain is a named list
// of steps that runs in order, each step's output feeding the next. Chains
// live in the same browser storage as job notes and presets; like them,
// they hold settings only, never files. Every chain and every step is
// normalised to the full key set on the way in and out, so a chain saved
// by any page reads the same on every page.
const CHAINS_KEY = 'benchzy-chains';

export function normalizeStep(step) {
  const s = step || {};
  return {
    tool: typeof s.tool === 'string' ? s.tool : 'compress-pdf',
    targetKB: typeof s.targetKB === 'number' ? s.targetKB : null,
    fromPage: typeof s.fromPage === 'number' ? s.fromPage : null,
    toPage: typeof s.toPage === 'number' ? s.toPage : null,
    text: typeof s.text === 'string' ? s.text : null,
  };
}

export function normalizeChain(chain) {
  const c = chain || {};
  return {
    id: typeof c.id === 'string' && c.id ? c.id : 'chain-' + Math.random().toString(36).slice(2, 9),
    name: typeof c.name === 'string' && c.name ? c.name : 'Untitled chain',
    steps: Array.isArray(c.steps) ? c.steps.map(normalizeStep) : [],
  };
}

export function getChains() {
  try {
    const arr = JSON.parse(localStorage.getItem(CHAINS_KEY) || '[]');
    return Array.isArray(arr) ? arr.map(normalizeChain) : [];
  } catch (e) { return []; }
}

export function saveChains(chains) {
  try {
    localStorage.setItem(CHAINS_KEY, JSON.stringify((chains || []).map(normalizeChain)));
  } catch (e) { /* storage unavailable: chains simply do not persist */ }
}

export function addChain(chain) {
  const chains = getChains();
  const c = normalizeChain(chain);
  chains.push(c);
  saveChains(chains);
  return c;
}

// Wire a tray for several files at once (merge bench). The callback gets
// an array of File objects, from the picker or from a drop.
export function wireTrayMulti(trayEl, inputEl, onFiles) {
  const pick = () => inputEl.click();
  trayEl.addEventListener('click', (e) => { if (e.target !== inputEl) pick(); });
  trayEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  inputEl.addEventListener('change', () => { if (inputEl.files.length) onFiles([...inputEl.files]); inputEl.value = ''; });
  for (const ev of ['dragenter', 'dragover']) {
    trayEl.addEventListener(ev, (e) => { e.preventDefault(); trayEl.classList.add('dragging'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    trayEl.addEventListener(ev, (e) => { e.preventDefault(); trayEl.classList.remove('dragging'); });
  }
  trayEl.addEventListener('drop', (e) => {
    const fs = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (fs.length) onFiles(fs);
  });
}

// Wire a tray (label + hidden file input + drag events) to a callback.
export function wireTray(trayEl, inputEl, onFile) {
  const pick = () => inputEl.click();
  trayEl.addEventListener('click', (e) => { if (e.target !== inputEl) pick(); });
  trayEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  inputEl.addEventListener('change', () => { if (inputEl.files[0]) onFile(inputEl.files[0]); });
  for (const ev of ['dragenter', 'dragover']) {
    trayEl.addEventListener(ev, (e) => { e.preventDefault(); trayEl.classList.add('dragging'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    trayEl.addEventListener(ev, (e) => { e.preventDefault(); trayEl.classList.remove('dragging'); });
  }
  trayEl.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}
