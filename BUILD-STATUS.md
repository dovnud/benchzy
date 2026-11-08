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

---

# Milestone 4 (2026-11-08): the localised background-removal set (wave 1A items 4–7)

LOCAL ONLY again: nothing pushed, deployed, registered or bought. The
site is now 26 pages. Wave 1A's page list is fully built except the
FFmpeg-gated MP4 to MP3 (item 18).

## Translation status, stated plainly first

**The Spanish and Portuguese strings on this site were drafted in-house
and are PENDING HUMAN REVIEW before any public launch.** No
native-speaker reviewer has read them yet. The pages below are verified
as software, not cleared as language. `TRANSLATIONS.md` in the project
root carries the same statement plus the at-risk list a reviewer should
read first: the stamp line ("Hecho en tu dispositivo" / "Feito no seu
dispositivo"), the job-ticket kicker ("Orden de trabajo" / "Ordem de
serviço"), ES regional terms ("ordenador de sobremesa" is Spain's;
"computadora de escritorio" is Latin America's), "tamaño completo" vs
"resolución completa" (ES) and "tamanho real" (PT) for full resolution,
the tray word ("bandeja"), the hash-check wording ("verificación" /
"verificação"), the no-subject message's tone, the error messages, the
footer counter idiom ("Bajo el mostrador" / "Debaixo do balcão"), the
PT nav's compressed "Ler digitalização", and the download suffixes
(`-sin-fondo.png` / `-sem-fundo.png`).

## String extraction (the refactor this milestone owed)

- `src/locales/bg.js` is now the single home of the background-removal
  strings: `ui` (the job-ticket furniture the pages render) and `msg`
  (the island's runtime messages), in en (source of truth), es, pt-BR.
- `src/scripts/remove-bg.js` imports the file and picks its set from
  `data-locale` on the `#bg-tool` section. Every status line, spec
  label, error message, the times line, the workbench job label and the
  download file-name suffix come from the locale; decimal commas are
  applied for es/pt-BR (44,3 MB). No English literal remains in the
  island's user-facing paths.
- The ticket markup itself is now one component,
  `src/components/BgTicket.astro`, rendering the furniture from the
  locale file. Both English BG pages were refactored onto it; their
  rendered furniture text was diffed against the pre-refactor build and
  is identical.
- `src/layouts/Base.astro` gained `lang` and `alternates` props and a
  per-locale chrome block: localised pages render `<html lang>`,
  hreflang tags, and Spanish/Portuguese nav and footer. The English
  chrome output is unchanged; pages without alternates get no new tags.

## Pages built (BUILD-PLAN 2.2 items 4–7)

4. `/es/quitar-fondo-de-imagen-gratis/` — the ES tool page: full
   rendered content in Spanish (what it does, how, honest limits, FAQ +
   FAQ schema with `inLanguage: 'es'`), the model size printed before
   load (44,3 MB, 11 verified pieces).
5. `/es/quitar-fondo-resolucion-completa/` — the ES full-resolution
   page: the same island (full variant furniture), the full-size
   promise, the measured dated remove.bg contrast and the
   commercial-use line, in Spanish.
6. `/pt-br/remover-fundo-de-imagem-gratis/` — the PT-BR tool page,
   same pattern, `inLanguage: 'pt-BR'`.
7. `/pt-br/alternativa-gratis-ao-remove-bg/` — the PT-BR free
   alternative page: the tool with alternative framing, the dated
   facts (1 December closing, the measured 577x433 free size, credits,
   non-commercial free results), and honest limits including the
   printed no-quality-crown / no-speed-crown lines.

Cross-links: two hreflang clusters (tool: EN/ES/PT-BR; full-size:
EN/ES/PT-BR-alternative), each page also carrying a visible
language line linking its twins and back. Hubs updated: the
background-removal hub gained a Spanish/Portuguese section with all
four doors, the all-tools hub lists both localised tool pages, and the
image-tools hub links the ES and PT-BR tool pages from its intro.

Claim discipline held: no localised page claims a speed or quality
result the English pages do not claim; phone times are explicitly
unmeasured in every locale; the model size is printed in body text
before anything loads, in the local decimal format.

## Verified (verify/verify.mjs, extended; headless Chrome, dist/ served locally)

- `astro build` clean, **26 pages**.
- **All 26 pages load with zero console errors and zero failed
  requests.** The harness now also records i18n wiring per cluster
  page: html lang, island `data-locale`, the four hreflang alternates,
  and the localised initial status line — all correct on all six
  cluster pages.
- Background removal run end to end from the ES tool page and the
  PT-BR tool page on corpus `test-bg-hard.png`: both completed a
  correct full-size cutout (1200x900, 915 KB output — byte-size
  identical to the English runs), with localised status lines
  ("Listo." / "Pronto."), localised times lines ("Recorte: 11,8 s.
  Resultado a tamaño completo…" / "Recorte: 11,1 s. Resultado em
  tamanho real…") and localised download names
  (`test-bg-hard-sin-fondo.png` / `test-bg-hard-sem-fundo.png`).
  The English run re-passed unchanged (program start 2.7 s, cutout
  11.2 s, 915 KB, all 11 model pieces in the service-worker cache).
- English regression suite re-ran unchanged: compress image to
  200 KB **byte-identical to the bench again (199,856 B at q40)**;
  compress PDF photo 415,377 B under 500 KB; OCR key strings present
  with the known decimal flaw reproduced; merge 25 files at 6,673 B;
  presets 90,117 B / 50,112 B; size checker exact; witness 0 requests
  during the job; service worker active (47 cached entries) with the
  offline reopen still passing.
- One recorded drift, content-verified: the split range output is
  3,590 B this run against 3,588 B in milestone 2. The file itself was
  extracted and checked: exactly 5 pages carrying PAGE-01..05 and
  nothing else. The 2 bytes sit in file metadata, not content; the
  gate results above (byte-identical image output, exact merge size)
  are unaffected.
- Screenshots of the ES tool page (desktop and mobile) and the PT-BR
  tool page (desktop) read against the anti-slop list: same paper /
  ink / orange ticket language, localised nav and footer, flat
  offset-shadow buttons, no gradients, no bento grids, no emoji, no
  glow. No defects found.

## Final wave-1A status

- **23 of 24 wave-1A pages are built**: items 1–17 (English tools,
  presets, OCR, Merge, the shutdown set, the proof and commitments
  pages), items 19–24 (hubs and the size checker), and now items 4–7,
  the localised background-removal set, with items 2–3 (full-resolution
  page and BG hub) and 8–11 (vs, guide, explainer, API note) from
  milestone 3.
- **The one remaining 1A page is item 18, MP4 to MP3**, still
  FFmpeg-gated: it builds only when the licence route is settled, and
  per the plan it slips to wave 1B without blocking anything else.
- 1A infrastructure is complete: chunked hash-verified model delivery
  (T4) and the service worker shipped in milestone 3; the workbench
  chain test (T7 acceptance), memory guard (T8), speed budget with
  the design layer on (T11) and HowTo schema remain owed beyond 1A,
  as listed in milestone 3.
- Before any public launch, two human gates stand in front of this
  milestone's pages: the native-speaker review of the ES and PT-BR
  strings (TRANSLATIONS.md), and the self-hosted font files noted in
  milestone 1.

---

# Milestone 5 (2026-11-08): the SEO/GEO technical pass

The launch-readiness pass over the finished 26 pages. A dist/ check at
the start of the milestone confirmed the gaps exactly: no sitemap.xml,
no robots.txt, no canonical tags, no HowTo schema, no llms.txt, no OG
cards (FAQ schema and meta descriptions already shipped). All of it is
fixed below. The final production build in dist/ is the verified one:
**92 files, 104,603,035 bytes** (the bulk is the engine assets and the
11 model pieces, as in every milestone).

## What was added

- **Sitemap** — `src/pages/sitemap.xml.js`, an endpoint that derives
  its route list from the page files in src/pages at build time (never
  typed, so pages enter and leave on their own), lastmod = build date,
  and hreflang alternates for the two background-removal language
  clusters (tool cluster and full-size cluster, x-default = the
  English page, matching the clusters the pages declare). Generated
  sitemap: **26 URLs, 24 hreflang links**, and the audit proves the
  URL set equals the built page set exactly.
- **robots.txt** — `public/robots.txt`: wildcard allow for everyone,
  then the AI crawlers welcomed BY NAME (GPTBot, ChatGPT-User,
  OAI-SearchBot, ClaudeBot, Claude-User, Claude-SearchBot,
  PerplexityBot, Perplexity-User, Google-Extended, CCBot,
  Applebot-Extended, Meta-ExternalAgent, plus Amazonbot and
  Bytespider), each with its own Allow group, and the sitemap line.
  Nothing is disallowed anywhere; the audit fails if any Disallow
  appears. Being cited is the strategy, so the door is open by name,
  per MARKETING.md section 4.1.
- **Canonical + social cards, in the base layout** — `astro.config.mjs`
  gained `site: 'https://benchzy.com'`; `Base.astro` now emits one
  self-referencing canonical per page (`https://benchzy.com` + the
  page's own path) and Open Graph + Twitter card tags drawn from the
  same title/description props each page already passes (og:type,
  site_name, locale per page language, title, description, url,
  image). One shared card image: `public/og.png`, 1200x630, generated
  by `tools/make-og-image.mjs` (a screenshot of an HTML card in the
  site's ticket language: paper #faf5ea, ink frame, serif wordmark,
  mono lines, the stamp; no gradients, no glow, no stock art). The
  first two renders had the stamp overlapping card text; the final
  render, read before shipping, is clean.
- **HowTo schema on all 14 tool pages** — each tool page gained a
  HowTo JSON-LD block beside its FAQ block (3–4 steps per page;
  localised pages carry `inLanguage` and their own language's steps).
  Every step is transcribed from that page's own intro, ticket labels
  (tray text, run button, download button) and "How it works" text;
  no step describes anything the page does not itself describe. This
  closes the HowTo debt carried since milestone 1.
- **llms.txt** — `public/llms.txt`: a plain factual index of the 10
  tool pages, the 4 hubs, the shutdown set, the localised set and the
  standing pages, one line each with its benchzy.com URL. Recorded
  here as HYGIENE, per the calibration in MARKETING.md section 4.1:
  our own research found no measured ranking effect for this file
  across ~300K domains; it costs nothing and signals intent. It is
  not a growth claim.
- **The promise line, with a computed score** — `/what-free-means/`
  gained a "One workshop, every job" section stating the aim in the
  owner's words ("Our promise: every file job in one place. We are
  growing Benchzy into the biggest toolkit on the web, tool by tool,
  and the count below is the score."), followed by a score the build
  computes from the page sources themselves: **7 working tools, 14
  tool pages, 26 pages in all**. Definitions are printed on the page:
  a tool is a distinct working engine; preset pages and translations
  count as pages, never as new tools. One build lesson recorded: a
  glob never returns the importing file itself, so the page adds
  itself back (+1), verified against the audit's independent recount
  from src/ (same numbers). "Biggest" as a claim about Benchzy appears
  ONLY in this section, as an aim; the audit (below) enforces it.

## Title and description audit (against SEO-DEMAND target terms)

Every page's title was checked against its target term in
notes/SEO-DEMAND.md (head terms section 2.1, size family 2.3, AI jobs
2.5, ranked matrix section 3) and every description for specificity.
Three titles missed their exact head term and were fixed:

| Page | Before | After | Term |
|---|---|---|---|
| /merge-pdf/ | Merge PDFs into one file, free, in your browser | Merge PDF: put PDFs into one file, free, in your browser | merge pdf (HEAD, §3 #23) |
| /split-pdf/ | Split a PDF by pages, free, in your browser | Split PDF by pages, free, in your browser | split pdf (HEAD, §3 #25) |
| /ocr-pdf/ | Read a scanned PDF (OCR), free, in your browser | OCR PDF: read a scanned PDF, free, in your browser | ocr pdf (§3 #41) |

Checked and left as they stand (title carries its term): remove
background / background remover (both BG pages, the hub, both ES and
both PT-BR pages, in their own languages), compress PDF and compress
PDF to 200 KB, compress image and compress image to 50 KB, file size
checker, the three hubs, the whole shutdown set (remove.bg terms),
the proof and commitments pages, credits, and the homepage (brand
page). Descriptions: all 26 are specific to their page (job, target,
method, limit); none was generic and none was changed.

## Internal-link audit (crawl of the built site, verify/seo-audit.mjs)

- **Orphan pages: 0.** Every page has at least one inbound internal
  link (footer and nav links counted, as a crawler sees them).
- **Click depth from home:** depth 0: 1 page (home); depth 1: 14
  (nav tools, both preset pages, proof, commitments, credits);
  depth 2: 8 (the BG hub, the PDF and image hubs, the vs page, all
  four localised pages); depth 3: 3 (/remove-bg-alternatives/,
  /remove-bg-december-1/, /remove-bg-api/, all reached through the
  BG hub, where the plan puts them). **Nothing is deeper than 3
  clicks, so no link fixes were needed**; the audit now fails the
  build if a page ever becomes an orphan or sinks past depth 3.

## Schema spot-checks

The audit parses EVERY JSON-LD block on every page (all parse; the
full per-page type table is in verify/seo-audit.json). Three named
spot-checks: /merge-pdf/ → [FAQPage, HowTo]; /remove-background/ →
[FAQPage, HowTo]; /es/quitar-fondo-de-imagen-gratis/ → [FAQPage,
HowTo] with inLanguage on both. All 14 tool pages carry FAQPage +
HowTo; no other page claims a HowTo.

## "Biggest" guard

The audit strips the reviewed rival references ("the biggest
converter", "the biggest PDF site", "the biggest site" — the measured
incumbents of NUMBERS.md — and "the biggest one", the biggest photo
inside a PDF in the compress pages' own text) and then fails if
"biggest" or "most tools" appears anywhere outside
/what-free-means/. It passes: as a claim about Benchzy, the word
exists only as the stated aim on the commitments page.

## Verified

- `astro build` clean: 26 pages + /sitemap.xml.
- `verify/seo-audit.mjs`: **ALL CHECKS PASSED** — sitemap parses and
  its 26 URLs equal the dist page set; exactly one canonical per
  page, self-referencing; OG/Twitter complete on all 26; robots
  names every AI crawler and disallows nothing; llms.txt present;
  all JSON-LD parses; HowTo on all 14 tool pages; 0 orphans; max
  depth 3; the promise page's printed score (7 / 14 / 26) equals the
  audit's independent recount; the "biggest" guard passes.
- `verify/verify.mjs` full regression on this dist: **all 26 pages
  load with zero console errors and zero failed requests**; every
  tool re-ran unchanged — compress image byte-identical to the bench
  again (199,856 B at q40), compress PDF photo 415,377 B under the
  500 KB target, presets 90,117 B / 50,112 B, merge 25 files, OCR key
  strings with the known decimal flaw, size checker exact, witness 0
  requests during the job, service worker active (47 cached entries,
  offline reopen passing), background removal full-size 1200x900,
  915 KB in EN (cutout 10.9 s), ES (11.3 s) and PT-BR, all 11 model
  pieces cached after the run.

## Left open after milestone 5

Nothing on this milestone's list. The standing pre-launch items from
earlier milestones are unchanged and were out of scope here: the
ES/PT-BR human translation review (TRANSLATIONS.md), self-hosted font
files, the workbench chain test (T7), the memory guard (T8), the
speed budget with the design layer on (T11), the compress-PDF 200 KB
ladder refinement, and MP4 to MP3 behind the FFmpeg licence gate.

## LAUNCHED (2026-11-08, by owner order "launch as is")
- Deployed to Cloudflare Pages project "benchzy" via Wrangler Direct Upload from inside dist (93 files, 104,603,067 B incl. the IndexNow key file added at launch; largest single file 14.8 MB WASM, under the 25 MB limit). Deployment URL e383942a.benchzy.pages.dev; benchzy.pages.dev serves the same build.
- Custom domains attached: benchzy.com and www.benchzy.com. The zone had ZERO DNS records, so the Pages attach created none; CNAMEs (@ and www -> benchzy.pages.dev, proxied) were added via API. Apex verified active/active/active and serving 200 with the correct title; www serves 200 (its Pages validation was still finishing at last check).
- Live verification from the public side: all 26 sitemap URLs return 200; model manifest and a 4 MB chunk serve at full size; robots.txt, llms.txt, og.png and the IndexNow key file all serve.
- IndexNow: bulk endpoint dropped once, then 403 from both api.indexnow.org and bing.com, singles also refused; 0 of 26 accepted. Carried for retry once the key file has aged; NOT reported as submitted. GSC domain property + Bing Webmaster sitemap submission run through the signed-in browser (in progress at launch time).
- ES/PT-BR pages are LIVE as built (owner's "as is" order); the 12 at-risk translation strings remain flagged PENDING HUMAN REVIEW in TRANSLATIONS.md.
- Source snapshot pushed: commit 7afe7ad4 (milestone 5 set, 57 text paths; public/og.png is binary and cannot ride the snapshot route, it lives in the repo history only as a reference in tools/make-og-image.mjs which regenerates it).
- INDEXING COMPLETE (2026-11-08, browser run 17:59-18:03 UTC): Bing Webmaster: site added manually, verified by DNS CNAME (3414b239baf55c1d9cfbf462b767a2f0 -> verify.bing.com, added via API), sitemap submitted: "Success", 26 URLs discovered, last crawl same day, 0 errors/warnings. Google Search Console (signed in as the owner Gmail account): Domain property benchzy.com verified by DNS TXT at root (added via API); sitemap submitted with the full URL (bare "sitemap.xml" was rejected once), detail page confirms "Sitemap processed successfully", last read 11/8/26, 26 pages discovered. IndexNow remains 0/26 (403) and is carried to the next deploy's retry list.

## Milestone 6: the BUILD NEXT paid-tools batch (2026-11-08, LOCAL ONLY, not deployed, not pushed)

Built the seven BUILD NEXT rows from file-toolkit/PAID-TOOLS-QUEUE.md as
12 new English pages, in the current design system exactly as-is.
src/layouts/Base.astro, src/styles/global.css and src/pages/index.astro
were NOT touched (reserved for the reskin pass, per owner instruction
mid-build). Linking runs home -> /tools/ -> hub -> tool page, so depth
stays <= 3 with zero orphans. Site counts, computed by the build on
/what-free-means/ and re-derived independently by verify/seo-audit.mjs:
**9 working tools, 25 tool pages, 38 pages in all** (was 7 / 14 / 26).
The two new engines are sign-pdf and flatten-pdf; the batch doors,
interleave and workflows are runner pages over the measured engines
and do not inflate the tool count.

### Pages added
- /batch-compress-pdf/, /batch-merge-pdf/ (folder pick + name sort),
  /batch-split-pdf/ — one runner (src/scripts/batch-pdf.js, data-mode),
  engines via src/scripts/lib/pdf-compress-core.js (the compress island's
  own ladder/probe/build budget, extracted verbatim) + pdf-lib copying.
- /batch-compress-images/, /batch-convert-images/ — one runner
  (batch-image.js) over lib/image-core.js (the compress-image island's
  combined quality-and-size search verbatim; webp encode WASM vendored
  to public/codecs/webp_enc.wasm). /batch-remove-background/ over
  lib/bg-engine.js (the island's chunked, hash-checked model loader and
  inference, verbatim) + the service worker as-is.
- /workflows/ (builder + runner + saved chains in localStorage key
  'benchzy-chains', via workbench.js chain storage) and /presets/
  (four starter chains, saved idempotently; a content page, deliberately
  not counted as a tool page). Shared chain definitions in
  lib/chains.js. This closes the workbench chain test gap T7 (below).
- /sign-pdf/ — self-sign only; scope block printed before the tray (no
  requests to others, no certificates, no legal e-signature claim);
  draw/type signature + initials + date, embedded as page content.
- /compress-pdf-strong/ — the compress island with data-mode="strong";
  lib core walks STRONG_RUNGS to the smallest honest result.
- /interleave-pdf/ — A1 B1 A2 B2 dealing with start-side choice and a
  back-to-front option for the second file (duplex scan repair).
- /split-pdf/ gained a third mode, split by size (parts under a chosen
  KB, each built and byte-checked, over-limit parts repaired by moving
  the last page forward; a single over-limit page forms its own part
  and its download line says so).
- Hubs updated: /tools/ (new "Batch and workflows" family + doors),
  /pdf-tools/, /image-tools/, /background-removal/; cross-links from
  the single-tool pages; /credits/ gained the JSZip row (MIT);
  public/llms.txt lists all 12. Registry entry shapes asserted in node
  (verify/registry-shape.mjs): every entry carries exactly its sibling
  key set. All green.

### Proof numbers (verify/verify.mjs, final run 2026-11-08 20:17 UTC)
Full suite: 38 pages, ZERO console errors and ZERO failed requests on
every page and in every tool test; verify/seo-audit.mjs ALL CHECKS
PASSED (38 sitemap URLs, 25 tool pages with HowTo + FAQ, depth <= 3).
Pre-existing gates reproduce: compress-image 199,856 B byte-exact,
merge 6,673 B, preset-200 90,117 B, witness job 0 network requests,
service worker offline reopen ok.
- Batch compress PDF: photo PDF x2 -> 415,377 B each at the 500 KB
  target (byte-identical to the single-tool island's landing); text
  PDF kept as its 7,203 B original in the ZIP.
- Batch merge PDF: batch25 folder -> 6,673 B (bench 6,673 B; pdf-lib's
  save-time metadata jitters the container by a byte between runs,
  observed 6,673 / 6,674 across runs; the gate allows +-2 B).
- Batch split PDF: pages 1-2 of two files -> ZIP of two 2-page PDFs.
- Batch compress images: corpus photo at 200 KB -> 199,856 B,
  byte-exact against the bench landing.
- Batch convert images: corpus photo -> WebP q80 = 251,730 B, exactly
  the bench number (RIFF/WEBP verified).
- Batch remove background: hard photo -> 936,993 B cutout (the 915 KB
  bench figure). The second corpus file (a synthetic landscape) sits
  on the engine's no-subject threshold and flips between runs: cut in
  one run, honestly listed "no clear subject found" in another. The
  row is never silent either way; the gate asserts the flagship file.
- Workflows (T7 CLOSED): the Invoice pack starter saves to
  localStorage, loads into the builder, and runs end to end on
  batch-01..03 + the photo PDF -> merged-smaller.pdf, 416,151 B (the
  28-page merged file through the 500 KB step); after a page reload
  the saved chain is still listed. Two probe runs also passed
  (small-only -> merged.pdf 1,351 B; photo-only -> 415,377 B).
- Sign PDF: typed signature on the corpus 10-page PDF -> 10 pages out,
  exactly 1 image XObject placed on the last page (node-side pdf-lib).
- Strong compression: photo PDF -> 2,066 B at the deepest rung
  (12% size, quality 16). That number is right, not a blank-output
  bug: the corpus photo is per-pixel noise, resizing to 12% averages
  the noise away, and the bench's own grid records 1,045 B for the
  same photo at 0.125/q18. A sampled-variance guard was added to the
  shared core anyway: a decode that comes back flat is retried once,
  then counted unreadable rather than re-encoded into a blank page.
  Text PDF -> returned unchanged at 7,203 B with the honest note
  (including the bench's 7,203 -> 7,231 re-save fact).
- Interleave: 10-page A + 3-page B -> 13 pages; pdftotext marker
  order verified exactly: PAGE-01, SECOND-01, PAGE-02, SECOND-02,
  PAGE-03, SECOND-03, PAGE-04 ... PAGE-10.
- Split by size: see the extraction note below. Final behaviour on
  the shared-image fixture at a 5,000 KB limit: 3 parts of
  11,654,172 / 11,654,176 / 11,654,182 B, 3 pages total, every part
  flagged "over the limit: a single page is bigger than the limit" —
  the honest outcome the page copy describes, because each page
  carries the shared 11.65 MB image whole.
- Flatten PDF: generated fixture (verify/make-form-fixture.mjs: text
  field "Ada Lovelace", checked checkbox, dropdown) -> spec counts
  3 fields before the run; output has 0 form fields left (node-side
  pdf-lib) and pdftotext still reads "Ada Lovelace": the value is
  baked in, not lost.

### Bugs found by the gates and fixed (all reproduced first)
- compress-pdf.js: the milestone-6 strongMode line used $ before its
  const declaration (TDZ) — every compress page threw on load. Moved
  below the definition; pre-existing compress gates re-verified.
- interleave-pdf.js: called a setSpec helper that was never defined.
- workflows.js: the merge runner was declared (items, log) but the
  dispatcher calls every runner (items, step, log), so its log was
  the step object and every chain died instantly ("e is not a
  function"). Signature fixed; T7 run above is the proof.
- flatten-pdf.js: the annotation count poked a.dict.lookup on an
  internal object shape that lacks it and the throw failed the whole
  inspection on any form-bearing file. The walk is defensive now.
- Batch ZIPs were only built for 2+ outputs in the image/batch-BG
  runners; now built for 1+ like the PDF runner, so the promised
  single ZIP always exists.
- EXTRACTION REWRITE (the substantive one): copyPages into a fresh
  document silently drops images that a PDF keeps in resources
  shared through the page tree — on the bench's 3-page photo PDF,
  pages 2 and 3 copied out at about 1.3 KB with no picture. Split
  extraction (Split PDF all modes, Batch split, workflow split step)
  is now delete-based: load, remove the unwanted pages, save. Every
  part renders whole. KNOWN LIMITATION, recorded not hidden: merge,
  batch merge, interleave and the workflow merge step still copy
  pages across documents (there is no delete-based cross-file merge),
  so a source file with inherited page-tree resources can lose those
  images in a merge. The bench corpus's merge files use per-page
  resources and are unaffected; the fix for the merge family is a
  resources-carrying copy, not yet built.

### Owed / deferred
- Homepage copy is stale by design freeze: it still says "Nine tools"
  and lists the wave-1A families. The reskin pass owns
  src/pages/index.astro and updates it.
- Nothing deployed, nothing pushed (milestone was local-only). The
  next deploy carries these 12 pages and should also retry the
  IndexNow list (26 old + 12 new URLs) per the launch note above.
- Verify helper scripts kept: verify/make-form-fixture.mjs,
  verify/registry-shape.mjs, verify/debug-m6.mjs, verify/probe-*.mjs
  (diagnostics from this milestone's bug hunts; harmless to keep).
- The verify suite relaunches headless Chrome before the heavy
  milestone-6 tests: in one long-lived browser, accumulated WASM and
  model memory starved the batch-BG big photo and the workflow waits.
  Each test passes in a fresh browser; the relaunch keeps the gate
  honest about the pages rather than about the harness.
