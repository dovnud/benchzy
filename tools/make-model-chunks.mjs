// T4: split the background-removal model into hashed chunks with a manifest.
// Source of truth stays in the file-toolkit bench; the site ships only the
// pieces plus model-manifest.json, and the loader verifies every piece's
// SHA-256 (and the whole file's) before the model is used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = '/home/hatch/workspace/file-toolkit/bench/model/imgly-isnet-small-quantized.onnx';
const OUT_DIR = path.join(HERE, '..', 'public', 'models');
const CHUNK_DIR = path.join(OUT_DIR, 'chunks');
const PIECES = 11;

const data = fs.readFileSync(SRC);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const whole = sha256(data);
console.log('source bytes', data.length, 'sha256', whole);

fs.rmSync(CHUNK_DIR, { recursive: true, force: true });
fs.mkdirSync(CHUNK_DIR, { recursive: true });
const chunkSize = Math.ceil(data.length / PIECES);
const chunks = [];
for (let i = 0; i < PIECES; i++) {
  const piece = data.subarray(i * chunkSize, Math.min(data.length, (i + 1) * chunkSize));
  if (piece.length === 0) break;
  const h = sha256(piece);
  const name = `chunk-${String(i + 1).padStart(2, '0')}-${h.slice(0, 16)}.bin`;
  fs.writeFileSync(path.join(CHUNK_DIR, name), piece);
  chunks.push({ file: `chunks/${name}`, bytes: piece.length, sha256: h });
  console.log(name, piece.length, h.slice(0, 16));
}
const manifest = {
  model: 'imgly-isnet-small-quantized (ISNet general-use weights via @imgly/background-removal-data)',
  totalBytes: data.length,
  sha256: whole,
  chunkSize,
  chunks,
};
fs.writeFileSync(path.join(OUT_DIR, 'model-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('manifest written:', chunks.length, 'chunks, total', data.length);
