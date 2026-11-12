// Crop image: cut a rectangle out of a picture, in this browser.
// The picture is decoded once by the shipped image stack (the same
// readers the convert doors run, HEIC included), held on a canvas,
// and the crop is cut from that canvas at full resolution: the box
// on screen is a guide, the numbers are the truth. Drag the box to
// move it, drag its corner to size it, drag anywhere else to draw
// a new box, or type exact pixels. Aspect presets hold the shape
// while the size changes. The output is written by the browser's
// own canvas writer in the input's format where the canvas has
// one (JPG, PNG, WebP); anything else (HEIC, GIF and friends)
// comes out as a PNG, and the page says so before the run.
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { initImageCodecs, decodeImageFile, hasAlpha } from './lib/image-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('cr-tray'), input = $('cr-file'), spec = $('cr-spec');
const stage = $('cr-stage'), canvas = $('cr-canvas'), box = $('cr-box'), handle = $('cr-handle');
const runBtn = $('cr-run'), status = $('cr-status'), result = $('cr-result');
const inX = $('cr-x'), inY = $('cr-y'), inW = $('cr-w'), inH = $('cr-h');
const NAMES = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
let file = null, srcCanvas = null, imgW = 0, imgH = 0, running = false;
let crop = { x: 0, y: 0, w: 0, h: 0 };
// The last position the visitor TYPED, kept apart from the box on
// screen (milestone 25). The clamp below keeps the box inside the
// picture at the size in force right now, so while the box still
// spans the whole picture a typed position clamps to 0 on screen —
// but the typed numbers are the visitor's, and losing them because
// the size was not typed yet was the defect this fixes. The typed
// position is re-applied at every later size change, clamped only
// by the smallest amount the new size truly forces. Dragging the
// box or picking a shape preset hands control back to the box and
// forgets the typed position.
let typedX = null, typedY = null;
let aspect = null; // width / height, or null for free
let outFormat = 'png', alpha = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function kindOfFile(f) {
  if (f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)) return 'jpeg';
  if (f.type === 'image/png' || /\.png$/i.test(f.name)) return 'png';
  if (f.type === 'image/webp' || /\.webp$/i.test(f.name)) return 'webp';
  if (f.type === 'image/heic' || f.type === 'image/heif' || /\.hei[cf]$/i.test(f.name)) return 'heic';
  return 'other';
}

const clampCrop = () => {
  crop.w = Math.max(1, Math.min(Math.round(crop.w), imgW));
  crop.h = Math.max(1, Math.min(Math.round(crop.h), imgH));
  crop.x = Math.max(0, Math.min(Math.round(crop.x), imgW - crop.w));
  crop.y = Math.max(0, Math.min(Math.round(crop.y), imgH - crop.h));
};

function paintBox() {
  if (!imgW) return;
  box.style.left = (crop.x / imgW * 100) + '%';
  box.style.top = (crop.y / imgH * 100) + '%';
  box.style.width = (crop.w / imgW * 100) + '%';
  box.style.height = (crop.h / imgH * 100) + '%';
  // A remembered typed position is shown as typed, never overwritten
  // with the temporarily clamped on-screen one.
  if (document.activeElement !== inX) inX.value = typedX !== null ? typedX : crop.x;
  if (document.activeElement !== inY) inY.value = typedY !== null ? typedY : crop.y;
  if (document.activeElement !== inW) inW.value = crop.w;
  if (document.activeElement !== inH) inH.value = crop.h;
}

function fitAspectToBox() {
  if (!aspect) return;
  let w = crop.w, h = Math.round(w / aspect);
  if (crop.y + h > imgH) { h = imgH - crop.y; w = Math.round(h * aspect); }
  if (crop.x + w > imgW) { w = imgW - crop.x; h = Math.round(w / aspect); }
  crop.w = w; crop.h = h;
  clampCrop();
}

wireTray(tray, input, async (f) => {
  file = null;
  result.classList.add('hidden');
  runBtn.disabled = true;
  stage.classList.add('hidden');
  try {
    setStatus('Loading the image program (about 2 MB, one time only) and reading the picture. It runs in your browser; your picture is never uploaded…');
    await initImageCodecs();
    const buf = await f.arrayBuffer();
    const img = await decodeImageFile(f, buf);
    file = f;
    imgW = img.width; imgH = img.height;
    alpha = hasAlpha(img);
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = imgW; srcCanvas.height = imgH;
    srcCanvas.getContext('2d').putImageData(img, 0, 0);
    canvas.width = imgW; canvas.height = imgH;
    canvas.getContext('2d').putImageData(img, 0, 0);
    const kind = kindOfFile(f);
    outFormat = NAMES[kind] ? kind : 'png';
    crop = { x: 0, y: 0, w: imgW, h: imgH };
    typedX = null; typedY = null;
    if (aspect === -1) aspect = imgW / imgH; // the "original shape" preset follows the picture
    fitAspectToBox();
    clampCrop();
    stage.classList.remove('hidden');
    paintBox();
    setSpec([
      ['file', f.name],
      ['format in', kind === 'other' ? (f.type || 'unknown') : NAMES[kind] || kind.toUpperCase()],
      ['dimensions', imgW + ' x ' + imgH + ' px'],
      ['size now', fmtBytes(f.size)],
      ['comes out as', NAMES[outFormat] + (kind !== outFormat ? ' (this format has no canvas writer here)' : '')],
    ]);
    runBtn.disabled = false;
    setStatus('Ready. Drag the box, drag its corner, or type exact pixels, then press Crop.');
  } catch (err) {
    setStatus('That file could not be read as a picture: ' + (err && err.message ? err.message : err));
  }
});

// --- the box: move, resize by its corner, or draw a new one ---
let drag = null; // { mode: 'move'|'resize'|'draw', startX, startY, orig }
function stagePoint(ev) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(imgW, (ev.clientX - r.left) / r.width * imgW)),
    y: Math.max(0, Math.min(imgH, (ev.clientY - r.top) / r.height * imgH)),
  };
}
stage.addEventListener('pointerdown', (ev) => {
  if (!file || running) return;
  typedX = null; typedY = null; // the mouse takes over from the typed numbers
  const p = stagePoint(ev);
  const onHandle = ev.target === handle;
  const inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
  drag = { mode: onHandle ? 'resize' : inside ? 'move' : 'draw', startX: p.x, startY: p.y, orig: { ...crop } };
  stage.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
stage.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = stagePoint(ev);
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  if (drag.mode === 'move') {
    crop.x = drag.orig.x + dx;
    crop.y = drag.orig.y + dy;
  } else if (drag.mode === 'resize') {
    crop.w = drag.orig.w + dx;
    if (aspect) crop.h = Math.round(crop.w / aspect);
    else crop.h = drag.orig.h + dy;
  } else {
    const x0 = Math.min(drag.startX, p.x), y0 = Math.min(drag.startY, p.y);
    let w = Math.abs(p.x - drag.startX), h = Math.abs(p.y - drag.startY);
    if (aspect) {
      h = Math.round(w / aspect);
      crop.y = drag.startY;
      crop.x = x0;
      crop.w = w; crop.h = h;
      clampCrop();
      paintBox();
      return;
    }
    crop.x = x0; crop.y = y0; crop.w = w; crop.h = h;
  }
  clampCrop();
  paintBox();
});
stage.addEventListener('pointerup', () => { drag = null; });
stage.addEventListener('pointercancel', () => { drag = null; });

// --- exact pixels and aspect presets ---
function fromInputs(changed) {
  const nx = parseInt(inX.value, 10), ny = parseInt(inY.value, 10);
  const nw = parseInt(inW.value, 10), nh = parseInt(inH.value, 10);
  // Size first, then position, whatever order the visitor typed
  // them in: the position is judged against the newest size, and a
  // remembered typed position is re-applied here so a size change
  // can set it free instead of having destroyed it earlier.
  if (Number.isFinite(nw)) crop.w = nw;
  if (Number.isFinite(nh)) crop.h = nh;
  if (aspect) {
    if (changed === 'w') crop.h = Math.round(crop.w / aspect);
    else if (changed === 'h') crop.w = Math.round(crop.h * aspect);
  }
  if (Number.isFinite(nx)) { crop.x = nx; typedX = nx; }
  else if (typedX !== null) crop.x = typedX;
  if (Number.isFinite(ny)) { crop.y = ny; typedY = ny; }
  else if (typedY !== null) crop.y = typedY;
  clampCrop();
  paintBox();
}
inX.addEventListener('change', () => fromInputs('x'));
inY.addEventListener('change', () => fromInputs('y'));
inW.addEventListener('change', () => fromInputs('w'));
inH.addEventListener('change', () => fromInputs('h'));
document.querySelectorAll('#cr-aspects .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#cr-aspects .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    typedX = null; typedY = null; // a preset reshapes the box on screen; it takes over
    const v = chip.dataset.aspect;
    if (v === 'free') aspect = null;
    else if (v === 'original') aspect = imgW && imgH ? imgW / imgH : -1;
    else { const [a, b] = v.split(':').map(Number); aspect = a / b; }
    if (aspect && imgW) { fitAspectToBox(); paintBox(); }
  });
});

runBtn.addEventListener('click', async () => {
  if (!file || !srcCanvas || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    clampCrop();
    const out = document.createElement('canvas');
    out.width = crop.w; out.height = crop.h;
    const ctx = out.getContext('2d');
    let flattened = false;
    if (outFormat === 'jpeg' && alpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      flattened = true;
    }
    ctx.drawImage(srcCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const blob = await new Promise((res) => {
      if (outFormat === 'png') out.toBlob(res, 'image/png');
      else out.toBlob(res, 'image/' + outFormat, 0.92);
    });
    if (!blob) throw new Error('the cropped picture could not be written');
    const dl = $('cr-download');
    dl.href = URL.createObjectURL(blob);
    dl.download = file.name.replace(/\.[^.]+$/, '') + '-cropped.' + EXT[outFormat];
    $('cr-achieved').textContent =
      'Cropped to exactly ' + crop.w + ' x ' + crop.h + ' pixels (from ' + imgW + ' x ' + imgH + '), ' +
      'starting at ' + crop.x + ', ' + crop.y + ' from the top-left corner. ' + NAMES[outFormat] + ', ' + fmtBytes(blob.size) + '.' +
      (flattened ? ' The see-through parts were painted over white, because JPG cannot hold transparency.' : '');
    result.classList.remove('hidden');
    const stamp = $('cr-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Crop image', name: file.name, detail: imgW + 'x' + imgH + ' to ' + crop.w + 'x' + crop.h });
  } catch (err) {
    setStatus('Something went wrong with this picture: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
