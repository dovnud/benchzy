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
