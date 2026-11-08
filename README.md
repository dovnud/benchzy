# Benchzy

Benchzy is a workshop of file tools that run inside the visitor's web browser.
Files are processed on the visitor's own device and are never uploaded: there
is no upload endpoint, no account system and no job counter in this codebase.
The site carries no sign-up and no watermarks on output.

Live tools in this milestone:

- **Remove background** — full-size cutouts from the ISNet model (imgly's
  quantized build, 44.3 MB), run through onnxruntime-web in the page. The
  model size is printed on the page before anything downloads.
- **Compress PDF to a size** — @cantoo/pdf-lib plus mozjpeg recompression of
  the photos inside the PDF, probe-first, against a target the visitor picks
  (200 KB / 500 KB / 2 MB presets or a custom number). The exact achieved
  size is shown; a PDF that cannot shrink is returned unchanged with an
  honest note.
- **Compress image to exact KB** — jSquash codecs with the combined
  quality-and-size search: when no quality setting lands close enough, the
  search adjusts the dimensions too. The achieved size and its distance from
  the target are shown.

The design language is the print-shop job ticket: warm paper, ink, mono type
for file data, one workshop-orange accent, and a rubber-stamp mark on every
finished job. No gradients, no emoji icons, no template look.

## Run it locally

```sh
npm install
npm run dev        # development server
npm run build      # static production build into dist/
npm run preview    # serve the production build
```

## Layout

- `src/pages/` — the five pages (home, the three tools, credits)
- `src/layouts/Base.astro` — header, footer, standing rules
- `src/scripts/` — the tool islands (`remove-bg.js`, `compress-pdf.js`,
  `compress-image.js`) and the shared workbench helpers (`workbench.js`):
  job notes and saved settings live in the browser's localStorage, metadata
  only, never files
- `public/models/` — the background-removal model (single file for this
  milestone; production delivery splits it into hashed chunks, see
  BUILD-STATUS.md)
- `public/ort/` — onnxruntime-web WASM binaries, self-hosted
- `public/codecs/` — jSquash codec WASM binaries, self-hosted
- `verify/` — the headless verification harness and its results

## Verification

```sh
npm run build
node verify/verify.mjs
```

This serves `dist/`, loads every page in headless Chrome watching for
console errors, runs the image and PDF tools end to end on the standard
test corpus, runs the background tool on the bench target photo, and saves
screenshots plus `verify/results.json`.

Status, gaps and the remaining page list live in `BUILD-STATUS.md`.
