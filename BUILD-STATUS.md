# BUILD-STATUS.md — Benchzy, milestone 1 (foundation + first working tools)

Date: 2026-11-08. LOCAL ONLY. Nothing in this milestone was pushed, deployed,
registered or bought. The tree at ~/workspace/benchzy-build/ is a plain
project folder (not a git clone) ready to be pushed to the owner's repo later.

## What exists

Astro 5 static site (JS islands only where a tool runs), Tailwind 4 under
custom design tokens implementing the print-shop job-ticket language from
TOOLKIT-SPEC section 6: warm paper (#faf5ea), ink blue-black (#1b2634), one
workshop orange (#d9551e), serif display face, grotesk body, mono for file
data only. No purple-blue gradients, no Inter, no bento card grids, no emoji
icons, no glowing buttons. Buttons and tickets use flat ink offset shadows;
finished jobs get the rubber-stamp mark ("Done on your device") with a worn
mask texture, animated with a short physical stamp-in (off under
prefers-reduced-motion).

Pages (5):
- `/` — homepage: hero job ticket with the standing spec block, tool index
  grouped by family (live tools stamped "On the bench"; measured-but-unbuilt
  tools listed honestly as "In the plan"), the workbench tray (job notes and
  saved settings in localStorage, metadata only), how-a-job-runs, and the
  network witness line.
- `/remove-background/` — working tool (below) with full rendered content:
  what it does, how, honest limits, FAQ + FAQ schema.
- `/compress-pdf/` — working tool, same content pattern.
- `/compress-image/` — working tool, same content pattern.
- `/credits/` — every engine, model and library with its licence.

Shared: Base layout (Benchzy text wordmark, nav, footer with standing rules
and the credits link), `src/scripts/workbench.js` (tray wiring, localStorage
job notes and presets, byte formatting).

## The three tools, as built

1. **Remove Background** (`src/scripts/remove-bg.js`).
   onnxruntime-web 1.31.1 through the package's **`/wasm` entry point**
   (decision, see below) + imgly's quantized ISNet, 44,342,436 bytes, served
   as ONE public asset for this milestone (`public/models/`). The size is
   printed on the page and in the file spec before anything loads; the model
   downloads only when the visitor presses start, with a live MB progress
   line. Preprocessing is the bench's own: 1024x1024, (pixel − 128) / 256;
   mask clipped [0,1]; composite at the photo's full resolution. Before/after
   comparison is a hand-rolled drag slider over a checkerboard (the shelf's
   img-comparison-slider was not wired in; the hand-rolled equivalent is
   ~40 lines, no extra dependency). Honest empty-subject handling: if the
   mask is near-empty (under 0.5% of pixels above half alpha and mean alpha
   under 4/255, thresholds set from the bench's subject-less measurements),
   the page shows "No clear subject found" and offers no download.
2. **Compress PDF to a target size** (`src/scripts/compress-pdf.js`).
   @cantoo/pdf-lib + jSquash mozjpeg. Scans every page's image XObjects,
   decodes each unique JPEG once, probes the largest photo (full size,
   quality 50) to pick a ladder starting point (ticket T1 probe-first), then
   rebuilds by REPLACING each image stream in place (`context.stream` +
   `context.assign`, so no orphaned originals bloat the output), measures,
   and adjusts rungs (keeps the largest result under target; two-rung jumps
   when far under; at most 6 builds). Presets 200 KB / 500 KB / 2 MB plus a
   custom KB field; last target saved as a browser preset. Non-JPEG photos
   are left untouched and the result line says so. A PDF with nothing
   compressible returns the original with the FINE-PRINT honest line.
3. **Compress Image to exact KB** (`src/scripts/compress-image.js`).
   jSquash jpeg/png/webp decode + mozjpeg encode + jSquash resize, WASM
   binaries self-hosted in `public/codecs/` and initialised explicitly, the
   same manual-init pattern as the Node benches. The shipping algorithm is
   the bench's COMBINED quality-and-size search (ticket T2): quality binary
   search first; if nothing lands within 0.5% over the target, a low anchor
   quality is fixed and dimensions are binary-searched too. Every attempt
   and its size is shown live. The achieved size, error %, quality and
   dimensions are printed on the result. A JPEG already under target is
   returned unchanged, and says so.

Fine-print promises kept in code: no counters exist anywhere (T10); no
sign-up; no upload path exists; the model/engine files are self-hosted;
limits and engine sizes are printed in body-size type, not footnotes.

## Verified (verify/verify.mjs, headless Chrome, dist/ served locally)

- `astro build` clean, 5 pages. (One Vite chunk-size warning for the two
  heavy islands; accepted for this milestone.)
- All 5 pages load with **zero console errors and zero failed requests**.
- Compress Image, corpus `test-large-photo.jpg` to the 200 KB target:
  **199,856 bytes (−2.4%), quality 40, full 4000x3000, 6 tries, ~7.5 s** —
  byte-identical to the bench's own result for the same job
  (bench/imgnums: 199,856 B at q40).
- Compress PDF, corpus `test-10page.pdf`: honest path exercised ("already
  under your target… your file back, unchanged").
- Compress PDF, bench photo PDF (11,653,298 B, built from the corpus noise
  photo) to 500 KB: **415,377 bytes at 50% photo size, quality 50**, valid
  PDF (pdfinfo reads it: 1 page, 415,377 B).
- Remove Background, corpus `test-bg-hard.png`, full in-page run:
  **program start 2.0 s, cutout 10.9–12.9 s across runs, full-size
  1200x900 PNG result (915 KB)**, cutout visually correct in the screenshot
  (subject and strand field kept, background transparent), no-subject state
  correctly NOT triggered. The 12.9 s first run matches BENCH-WEB's warm
  median (12.9 s).
- Screenshots (home + compress-image at desktop and mobile widths,
  remove-background result) were opened and read against the anti-slop
  list. Two defects found and fixed during the pass: empty preview <img>
  elements showed a broken-image placeholder before a file was picked
  (now hidden until they have content), and the stamp mask was eroding
  the stamp text to near-illegibility (erosion reduced; stamp now reads
  clearly with a worn edge). Rebuilt and re-verified after the fixes,
  including after pruning the unused ORT wasm variants (only
  ort-wasm-simd-threaded remains in public/ort).

Raw results: `verify/results.json`; screenshots in `verify/screenshots/`;
the downloaded 500 KB output at `verify/out-compressed-500k.pdf`.

## Decisions made inside the milestone (recorded, not silent)

- **onnxruntime-web `/wasm` entry point, not the default bundle.** The
  default bundle tried to load the JSEP module (WebGPU path) even for a
  WASM-only session and failed. The `/wasm` bundle is the measured route
  (plan T5: threads = 1, no WebGPU in v1). Found in verification run 1,
  fixed, re-verified.
- **Model as a single public file for this milestone.** Production delivery
  per ticket T4 is still owed: 11 hashed chunks (~4 MiB each) with a hash
  manifest on immutable content-hashed URLs, plus a service worker so a
  returning device fetches zero engine bytes.
- **Comparison slider hand-rolled** instead of the shelf's
  img-comparison-slider web component (fewer moving parts in an Astro
  island; the shelf component remains available if the design pass wants
  its keyboard behaviour).
- **FilePond and dnd-kit not wired yet.** The trays are a hand-rolled
  drop/click/keyboard surface for the single-file milestone tools. FilePond
  (batch) and dnd-kit (page grid) arrive with the tools that need them
  (BUILD-PLAN week-1 items), per the plan's own order.
- **Fonts are stacks, not files.** Display = Fraunces/Georgia serif stack,
  body = Archivo/system grotesk, mono = Plex Mono/system mono. Self-hosting
  the actual font files (LEGAL-CHECKS truth condition for launch) is a
  pre-launch step; on this machine the serif falls back to a Times-class
  face, which already carries the print voice in the screenshots.
- **GSAP/Lenis not wired.** No motion library ships in milestone 1; the
  only motion is the stamp animation in CSS. GSAP joins when the design
  pass does the paper-feed/stamp choreography; tool pages stay
  performance-first per DESIGN-REPOS rule 3.

## Stubbed or missing

- The workbench is notes + presets only: no batch queue, no chaining
  (outputs feeding the next tool), no ZIP download (ticket T7's full
  acceptance test is still owed).
- No service worker / offline caching yet (T4/T7 infrastructure).
- No HowTo schema yet (FAQ schema ships on all three tool pages; HowTo is
  listed in BUILD-PLAN 2.5 and still owed).
- The network witness line is copy (true by architecture: there is no
  endpoint to send to) but the per-tool T9 QA procedure (network panel
  watched during a run) has only been informally true in verification:
  the harness recorded every request during the tool runs and all were
  same-origin static assets (see failedRequests/console logs in
  verify/results.json — zero cross-origin job-data requests by
  construction).
- Memory guard (T8): not yet implemented; very large files on small
  phones can still fail ungracefully instead of getting the plain-words
  warning and a split path.
- Speed budget (T11) not yet measured with the design layer on.

## Remaining wave-1A pages, in BUILD-PLAN order (section 2.2)

2. Free background remover, full-resolution preset page (EN) — same island.
3. Background removal hub (EN).
4–5. ES background-removal tool + full-resolution pages (human-reviewed
   strings required; not machine output).
6–7. PT-BR background-removal tool + free-alternative page (human-reviewed).
8. Benchzy vs remove.bg comparison page (attorney template review first).
9. remove.bg alternatives guide page.
10. What happens to remove.bg on 1 December, explainer page.
11. API migration note page.
12–13. Compress PDF to 200 KB flagship preset page (the tool page itself
    is built here as milestone item 12's custom page).
14–15. Compress image to 50 KB preset page (tool/custom page built here).
16. OCR PDF (PDF.js at 300 DPI + Tesseract.js, ticket T3).
17. Merge PDF (pdf-lib; habit infrastructure).
18. MP4 to MP3 — FFmpeg-gated; slips to 1B if the route is unsettled.
19. Check it yourself page.
20. What free means here page.
21–23. All tools hub, PDF tools hub, Image tools hub (the homepage index
    is their stand-in for now).
24. Size checker.
Plus the 1A infrastructure: chunked model delivery (T4), service worker,
the workbench chain test (T7), memory guard (T8).

## Top gaps, plainly

1. Model delivery is a single 44.3 MB file, not the chunked hashed
   delivery the plan requires (T4) — the biggest production gap.
2. No service worker: returning visitors re-download engines; the offline
   claim cannot be made yet.
3. Wave 1A is 3 working tools of 24 pages; the dated set (live by
   28 November) still needs the localised background-removal pages with
   human review, the shutdown set, OCR and Merge.

---

# Milestone 2 (2026-11-08): the next six pages

LOCAL ONLY again: nothing pushed, deployed, registered or bought. The site
is now 11 pages, 9 of them working tools.

## Pages built (in the order built)

1. `/ocr-pdf/` — Read a scan (OCR), BUILD-PLAN 1A item 16.
   PDF.js 6.5.438 renders every page at 300 DPI (ticket T3; the bench's
   200 DPI collapse to 61.5% is why the number is fixed in code), then
   Tesseract.js 7 recognises the render. Both engines are self-hosted
   under `public/` (pdfjs build files; tesseract UMD + worker, the LSTM
   core variants only, and `eng.traineddata`, fetched with `gzip:false`
   so the plain data file is what ships). Output follows the bench's
   checkable-text rule: the recognised text lands in an editable box
   (the .txt download uses the visitor's corrected text), plus a
   searchable PDF — the page render with each recognised word laid over
   it at opacity 0 from the recogniser's word boxes. English only, up to
   50 pages in one go, both limits printed on the page.
2. `/merge-pdf/` — Merge PDF, 1A item 17. @cantoo/pdf-lib; a multi-file
   tray (`wireTrayMulti` added to workbench.js), per-file page counts,
   Up/Down/Remove ordering, pages copied not rebuilt. Unreadable files
   are marked on the list and excluded before the run.
3. `/split-pdf/` — Split PDF. A working-core tool from wave 1B pulled
   forward into this milestone's six (see deviation note). @cantoo/pdf-lib;
   one range out as a single PDF, or every page as its own PDF with one
   download per page (the page itself says a packed archive is in the plan).
4. `/compress-pdf-to-200kb/` — 1A item 13, the flagship preset page.
   The milestone-1 compress-pdf island with its target locked by the
   page: the island now reads `data-preset-kb` / `data-lock-target` from
   its ticket section, and a locked page ignores the visitor's saved
   general preset and saves none back.
5. `/compress-image-to-50kb/` — 1A item 15, the form/seller preset.
   Same lock mechanism on the compress-image island, target fixed at 50 KB.
6. `/size-checker/` — 1A item 24. Any file: exact byte count, size in
   both KB conventions, real format sniffed from magic bytes (not the
   file name), image dimensions, PDF page count and page size, media
   duration/frame size, and the file lined up against the common portal
   doors (200 KB to 25 MB, fits/too-big with the margin printed).

Homepage stamps updated (nine tools now "On the bench"; Convert and
resize remain honestly "In the plan"), nav gained Merge, Read a scan and
Size checker, and the credits page now names PDF.js and Tesseract.js
with their Apache-2.0 licences.

## Deviation from the plan's printed order, recorded

BUILD-PLAN section 2.2 items 2–11 (background-removal full-resolution
preset page, the BG hub, the ES and PT-BR sets, the vs page, the
alternatives guide, the 1 December explainer, the API migration note)
were NOT built in this milestone. The localised strings still need human
review and the vs page needs its attorney template first, so the English
tool pages were built first, per the milestone instruction; Split PDF
(1B) took the sixth slot. Items 2–11 remain at the head of the remaining
list below, in plan order, and nothing about them is unblocked by
anything in this milestone.

## Verified (verify/verify.mjs, extended in place; headless Chrome, dist/ served locally)

- `astro build` clean, 11 pages.
- All 11 pages load with **zero console errors and zero failed requests**.
- Milestone-1 tools re-verified unchanged: compress image to 200 KB
  byte-identical again (199,856 B at q40); compress PDF photo job again
  415,377 B under the 500 KB target; remove background again 12.0 s,
  full-size 1200x900 result, no-subject state not triggered.
- OCR, corpus `test-scanned-ocr.pdf`: the read text contains INVOICE,
  2026-TEST-0042, Widget and Total due. The bench's known flaw reproduced
  in the browser exactly as documented: 124.50 read as 12450 (decimal
  dropped), which the page copy warns about in plain words. The
  searchable PDF was captured as a real download and its text layer
  extracted locally (pdftotext reads INVOICE / 2026-TEST-0042 back out).
- Merge, the full corpus batch25: 25 files listed, merged output saved
  and checked outside the browser: **25 pages, 6,673 bytes** (byte-size
  identical to the bench's own merge), text extraction shows
  BATCH-01 through BATCH-25 in exact order.
- Split, corpus `test-10page.pdf`: range 1–5 output is **5 pages,
  3,588 bytes** (identical size to the bench's split halves) containing
  PAGE-01..05 and nothing else; every-page mode produced 10 downloads.
- Preset PDF page, bench photo PDF (11.65 MB) to the locked 200 KB
  target: **90,117 bytes, valid 1-page PDF** — under the target, but
  conservative next to the bench's 195,029 B landing; the in-page ladder
  stopped at a deep rung (35% size, quality 38) inside its 6-build
  budget. Recorded as a refinement gap below, not a pass at bench parity.
- Preset image page, corpus `test-large-photo.jpg` to the locked 50 KB
  target: **50,112 bytes** (−2.1% against the 51,200-byte target),
  quality 4, full 4000x3000, 6 tries.
- Size checker: corpus photo read back exactly (1,458,174 bytes,
  JPEG, 4000x3000, doors table rendered); corpus 10-page PDF read back
  exactly (7,203 bytes, 10 pages, 612x792 pt page size).
- Screenshots of two new pages (OCR and Merge, desktop; OCR also mobile)
  read against the anti-slop list: same paper/ink/orange ticket language,
  flat offset-shadow buttons, no gradients, no bento grids, no emoji,
  no glow. No defects found in this pass.

One bug found and fixed during verification: PDF.js 6 removed
`destroy()` from the document proxy; the OCR island now destroys via
`loadingTask`, and the tray read completes in about 5 s in the harness.

Raw results: `verify/results.json` (rewritten by the run); new outputs at
`verify/out-merged-25.pdf`, `verify/out-split-1-5.pdf`,
`verify/out-preset-200k.pdf`, and the captured OCR download in
`verify/downloads/`; screenshots in `verify/screenshots/` (ocr-pdf and
merge-pdf added).

## Remaining wave-1A pages, in BUILD-PLAN order (section 2.2)

2. Free background remover, full-resolution preset page (EN) — same island.
3. Background removal hub (EN).
4–5. ES background-removal tool + full-resolution pages (human-reviewed
   strings required; not machine output).
6–7. PT-BR background-removal tool + free-alternative page (human-reviewed).
8. Benchzy vs remove.bg comparison page (attorney template review first).
9. remove.bg alternatives guide page.
10. What happens to remove.bg on 1 December, explainer page.
11. API migration note page.
18. MP4 to MP3 — FFmpeg-gated; slips to 1B if the route is unsettled.
19. Check it yourself page.
20. What free means here page.
21–23. All tools hub, PDF tools hub, Image tools hub (the homepage index
    is their stand-in for now).
Plus the 1A infrastructure: chunked model delivery (T4), service worker,
the workbench chain test (T7), memory guard (T8). Done since the
milestone-1 list: items 12–17 (both tool pages were milestone 1; the
200 KB and 50 KB preset pages, OCR and Merge are this milestone) and
item 24 (size checker); Split PDF was pulled forward from 1B.
**13 of 24 wave-1A pages remain** (items 2–11, 18, 19, 20, 21–23).

## Top gaps after milestone 2, plainly

1. Model delivery is still a single 44.3 MB file (T4), and there is
   still no service worker — the two infrastructure debts from
   milestone 1 are untouched and remain the biggest production gaps.
2. The dated set's December-1 pages (items 2–11) are now the critical
   path: localised background removal with human review, the shutdown
   set, and the vs page behind its attorney template.
3. The compress-PDF ladder lands conservative on the 200 KB preset
   (90 KB where the bench reached 195 KB): under target, but it gives up
   photo quality it did not have to. Ladder/budget tuning is a small,
   named fix.
4. Still owed from milestone 1's list: HowTo schema, memory guard (T8),
   workbench chain test (T7), speed budget with the design layer on (T11).

---

# Milestone 3 (2026-11-08): the rest of English 1A + the infrastructure debts

LOCAL ONLY again: nothing pushed, deployed, registered or bought. The
site is now 22 pages. Wave 1A's English set is complete except the
FFmpeg-gated MP4 to MP3; what remains of 1A is the localised
background-removal set (milestone 4 by design).

## Pages built (BUILD-PLAN 2.2 item numbers)

2. `/remove-background-full-resolution/` — the full-resolution preset
   page: same island (same element IDs, second Astro page), preset copy
   and FAQ built on the full-size promise, the measured 577x433 contrast
   (live test, 7 November 2026) and the commercial-use line from
   remove.bg's terms, both dated on the page.
3. `/background-removal/` — the BG hub: tool, preset page, and the whole
   shutdown set as doors, plus a "what we do not claim" section (no
   quality crown, no speed crown, phone speed unmeasured).
8. `/vs-remove-bg/` — the comparison page, built under the task's
   claim-discipline rules in place of the pending attorney template:
   facts only (free size with the measured 577x433, credits and expiry,
   account, watermark from our live test, commercial use, processing
   location, 1 December), prices carrying the ESTIMATE label and their
   Oct–Nov 2026 dates on the row, and a printed "what this page does not
   claim" section. No quality or speed ranking anywhere.
9. `/remove-bg-alternatives/` — the alternatives guide: Canva (the
   official destination), Pixlr, Photoroom, Removal.ai, Pixelcut, each
   wall stated with its source class (own terms vs the dated shutdown
   coverage read 7 November 2026), and Benchzy's own entry with its real
   costs printed (44.3 MB first download, ~13 s desktop).
10. `/remove-bg-december-1/` — the explainer: what ends (site, accounts,
    every unused credit including pay-as-you-go sold as never expiring,
    self-service API, plugins and apps), sources named per line
    (remove.bg's own banner/terms read 7 Nov 2026; the shutdown FAQ "as
    reported" by Photoroom 2026-10-29, AI Tools Police 2026-10-26, Hokai
    2026-10-28), the enterprise-contracts line explicitly flagged
    reported-not-confirmed, a before-the-date checklist, one sales link.
11. `/remove-bg-api/` — the API migration note: keys stop 1 Dec, the
    official new home is Leonardo.Ai, old credit pricing labelled
    ESTIMATE, and the plain statement that Benchzy offers no API and
    nothing to migrate an integration to.
19. `/check-it-yourself/` — the proof page, built honestly: a live
    witness (src/scripts/witness.js) that logs every resource the page
    loads (browser Performance timeline) and every fetch/XHR the page
    makes (watchers installed before any job can run), then runs a real
    witnessed job (read a file, SHA-256 fingerprint, format sniff, image
    dimensions / PDF page count via @cantoo/pdf-lib) and prints the
    request count during the job. The page states exactly what this
    proves and what it does not, and gives the manual network-panel
    steps plus the per-family "what leaves your device" table.
20. `/what-free-means/` — the commitments page from FINE-PRINT.md: the
    never list (no accounts, no counters, no credits/minutes/meters, no
    watermarks, no download held for payment, no fake buttons, no
    smaller free size, no upload), why it can be free, and the
    device-limit frame. Worded as a public commitment, not a "free
    forever" guarantee, per FREE-SEO-PR's banned list.
21. `/tools/` — all-tools hub (live tools stamped, unbuilt families
    honestly "In the plan"). 22. `/pdf-tools/` — PDF hub, including the
    shut door (editable Word fidelity) stated plainly. 23.
    `/image-tools/` — image hub with the bench numbers and the AVIF
    slow-option note.

Also: nav gained "All tools"; the footer links the commitments and
proof pages; the homepage lists the full-resolution door and links its
network-witness line to the proof page; the credits page now describes
the chunked model delivery and the service worker's exact scope.

## Infrastructure

- **T4 chunked model delivery, DONE.** `tools/make-model-chunks.mjs`
  splits the canonical model (bench copy; its SHA-256 matched the
  shipped single file before that file was removed) into 11 pieces of
  4,031,131 bytes (last 4,031,126) with content-hash file names plus
  `public/models/model-manifest.json` (per-piece SHA-256 + whole-file
  SHA-256 7001d607…). `src/scripts/remove-bg.js` now fetches the
  manifest, downloads the pieces with per-piece progress, verifies
  every piece's hash and the whole file's hash (crypto.subtle), and
  refuses to run on any mismatch. The size is still printed (44.3 MB,
  "11 checked pieces") before anything loads. The single 44.3 MB
  public asset is gone; `public/models/` holds only the manifest and
  `chunks/`.
- **Service worker, DONE.** `public/sw.js`, registered from the base
  layout on every page. Scope, as written in its own header and on the
  credits page: pages are network-first with a cached fallback; engine
  assets (/models/, /ort/, /codecs/, /pdfjs/, /tesseract/) are
  cache-first; other same-origin assets stale-while-revalidate. It
  caches only what the visitor's browser has actually loaded; no
  broader offline claim is made anywhere on the site.

## Verified (verify/verify.mjs, extended; headless Chrome, dist/ served locally)

- `astro build` clean, **22 pages**. Chunk integrity checked outside
  the browser too: the 11 pieces reassemble to 44,342,436 bytes whose
  SHA-256 equals the manifest and the canonical bench model.
- **All 22 pages load with zero console errors and zero failed
  requests.**
- Background removal through the chunked loader, corpus
  `test-bg-hard.png`: **program start 2.8 s (pieces fetched and
  hash-verified), cutout 10.7 s, full-size 1200x900 result, 915 KB** —
  the same output size as the single-file milestones. After the run,
  the service-worker cache held all 11 model pieces plus the manifest.
- Service worker: registration active; after the page loop its cache
  held 39 entries; **an offline reload of a visited page succeeded**
  (title and content served from cache with the network off).
- Witness: the witnessed job on corpus `test-10page.pdf` (10 pages,
  fingerprint shown) finished with **0 network requests during the job
  and 0 requests with anything attached**, printed on the page.
- All milestone 1–2 tool checks re-ran unchanged: compress image
  199,856 B at q40 (byte-identical to bench), compress PDF photo
  415,377 B under 500 KB, OCR key strings present with the known
  decimal flaw reproduced, merge 25 files (6,674 B), split halves
  3,588 B, presets 90,117 B / 50,112 B, size checker exact.
- Screenshots of the two new pages (vs-remove-bg and check-it-yourself,
  desktop; check-it-yourself also mobile) read against the anti-slop
  list: ticket language, flat offset shadows, no gradients, no bento
  grids, no emoji, no glow. One defect found and fixed: a stray empty
  header row at the top of the vs table; rebuilt and re-verified after
  the fix (final run: 22/22 pages clean).

## Remaining wave-1A, final list

- Items 4–7: the ES tool + full-resolution pages and the PT-BR tool +
  free-alternative page. Localised strings are a human-review job;
  milestone 4. No strings file was extracted in this milestone (the BG
  island's strings live inside remove-bg.js and the two Astro pages,
  so extraction is a milestone-4 task, not a trivial separation).
- Item 18: MP4 to MP3, still FFmpeg-gated; no change.
- That is all of 1A. Everything else on the milestone-2 remaining list
  (items 2, 3, 8–11, 19, 20, 21–23, T4, service worker) is built above.

## Still owed beyond 1A (unchanged from earlier lists)

HowTo schema; memory guard (T8); workbench chain test (T7's full
acceptance); speed budget with the design layer on (T11); the
compress-PDF preset ladder refinement (200 KB preset lands ~90 KB
where the bench reached ~195 KB); self-hosted font files before
launch; FilePond/dnd-kit arrive with the batch and page-grid tools in
1B.
