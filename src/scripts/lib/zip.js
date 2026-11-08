// Packing several results into one download. JSZip (MIT, named on the
// credits page), elected in LEGAL-CHECKS for build ticket T7. Entries are
// STORED, not deflated: PDFs and images are already compressed, so
// squeezing them again would burn the visitor's CPU for almost nothing.
import JSZip from 'jszip';

// entries: [{ name, data: Blob | Uint8Array | ArrayBuffer }]
export async function makeZip(entries, zipName) {
  const zip = new JSZip();
  const seen = new Map();
  for (const e of entries) {
    let name = e.name;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? name.slice(0, dot) + '-' + n + name.slice(dot) : name + '-' + n;
    } else seen.set(name, 1);
    zip.file(name, e.data);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, name: zipName || 'benchzy-batch.zip' };
}
