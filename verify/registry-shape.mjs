// Entry-shape rule (from the 29 Oct live-crash lesson): every registry
// entry must carry every key its siblings carry, with consistent types.
// Extracts the arrays from the hub/tools pages and asserts shape unity.
// Run: node verify/registry-shape.mjs
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

function extractArray(file, marker) {
  const src = fs.readFileSync(ROOT + file, 'utf8');
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(file + ': marker not found: ' + marker);
  let i = src.indexOf('[', start);
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue; }
    if (c === '[') depth++;
    if (c === ']') { depth--; if (depth === 0) { i = j; break; } }
  }
  const literal = src.slice(src.indexOf('[', start), i + 1);
  return new Function('"use strict"; return (' + literal + ');')();
}

function check(label, entries, expectedKeys) {
  const want = expectedKeys.slice().sort().join(',');
  entries.forEach((e, idx) => {
    const keys = Object.keys(e).sort().join(',');
    if (keys !== want) throw new Error(`${label}[${idx}] shape mismatch: got ${keys}, want ${want}`);
    expectedKeys.forEach((k) => {
      if (e[k] !== null && typeof e[k] !== typeof entries[0][k] && entries[0][k] !== null) {
        // href may be null on planned entries; types checked otherwise.
        if (typeof entries[0][k] !== 'string' || k !== 'href') {
          throw new Error(`${label}[${idx}].${k} type differs from siblings`);
        }
      }
    });
  });
  console.log(label + ': ' + entries.length + ' entries, shape OK (' + want + ')');
}

let failures = 0;
try {
  const families = extractArray('src/pages/tools.astro', 'const families');
  families.forEach((f) => {
    check('tools.astro family keys', [f], ['name', 'hub', 'tools']);
    check('tools.astro > ' + f.name, f.tools, ['name', 'href', 'live', 'note']);
  });
} catch (e) { failures++; console.log('tools.astro FAIL: ' + e.message); }

try {
  check('pdf-tools.astro live', extractArray('src/pages/pdf-tools.astro', 'const live'), ['name', 'href', 'note']);
} catch (e) { failures++; console.log('pdf-tools.astro FAIL: ' + e.message); }

try {
  check('image-tools.astro live', extractArray('src/pages/image-tools.astro', 'const live'), ['name', 'href', 'note']);
  check('background-removal.astro doors', extractArray('src/pages/background-removal.astro', 'const doors'), ['name', 'href', 'note']);
  check('presets.astro presets', extractArray('src/pages/presets.astro', 'const presets'), ['id', 'name', 'steps', 'job']);
} catch (e) { failures++; console.log('shape FAIL: ' + e.message); }

if (failures) { console.log('REGISTRY SHAPE: FAIL'); process.exit(1); }
console.log('REGISTRY SHAPE: OK');
