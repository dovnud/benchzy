// Shared core for reading words out of pictures (OCR), extracted from
// the photo-OCR island (milestone 10) so the workflow chains run the
// SAME reading path: Tesseract.js 7, LSTM core, self-hosted, and the
// bench's reading plan. The plan was benched on the photo page's own
// fixtures before it shipped (verify/m10-bench*.mjs): enlarging is a
// tax on clean pictures and a rescue on genuinely rough small ones
// (a 560 px wide, heavy-JPEG picture read 94.3% of characters as
// picked and 99.0% enlarged 3x), so only pictures under SMALL_LIMIT
// on the long side are enlarged, by ENLARGE_BY; over HUGE_LIMIT a
// copy is shrunk to the ceiling because the reader slows down for no
// gain up there. The picked file itself is never altered.

export const OCR_SMALL_LIMIT = 750;
export const OCR_ENLARGE_BY = 3;
export const OCR_HUGE_LIMIT = 6000;

export function ocrPlan(w, h) {
  const maxDim = Math.max(w, h);
  if (maxDim > OCR_HUGE_LIMIT) return { factor: OCR_HUGE_LIMIT / maxDim, kind: 'shrink' };
  if (maxDim < OCR_SMALL_LIMIT) return { factor: OCR_ENLARGE_BY, kind: 'enlarge' };
  return { factor: 1, kind: 'asis' };
}

export function ocrPlanText(p) {
  if (p.kind === 'enlarge') return 'small picture: enlarged 3x before reading';
  if (p.kind === 'shrink') return 'very large picture: shrunk to 6,000 px on the long side before reading';
  return 'read at the size you picked it';
}

// One worker per page, as on the islands: created for the language
// asked for, terminated and rebuilt if the language changes. The
// caller supplies the words: hooks.loading(lang) fires before the
// (one-time, ~10 MB) program load so each page prints its own honest
// loading line, and hooks.progress(pct) receives recognition progress.
// The Tesseract script itself is a classic script on the tool pages
// (window.Tesseract); pages that read words must load it.
let worker = null;
let workerLang = null;
let sink = null;

export async function getOcrWorker(lang, hooks) {
  if (hooks) sink = hooks;
  if (worker && workerLang === lang) return worker;
  if (worker) { try { await worker.terminate(); } catch (e) { /* already gone */ } worker = null; workerLang = null; }
  if (!window.Tesseract) throw new Error('the reading program did not load');
  if (sink && sink.loading) sink.loading(lang);
  worker = await window.Tesseract.createWorker(lang, window.Tesseract.OEM && window.Tesseract.OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    gzip: false,
    cacheMethod: 'none',
    logger: (m) => {
      if (m.status === 'recognizing text' && sink && sink.progress) sink.progress(Math.round(m.progress * 100));
    },
  });
  workerLang = lang;
  return worker;
}
