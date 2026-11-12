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
- MILESTONE 6 DEPLOYED (2026-11-08, owner instruction to keep shipping): Wrangler Direct Upload from inside dist (128 files, 105.9 MB), deployment 933ae4ae.benchzy.pages.dev. All 38 sitemap URLs verified 200 from the public side. IndexNow retried for all 38: 403 from both endpoints again (0 accepted; suspected Cloudflare bot protection challenging IndexNow's key-file validator; carried, with GSC/Bing sitemap discovery as the working route). Source pushed at b3827b10 (96 text paths; binaries vendored out of git as before).

## Milestone 7: the workbench-ledger reskin (2026-11-08, LOCAL ONLY, not deployed, not pushed)

The first live skin (print-shop job ticket) was never approved and was
judged "still a little ai slop" by the owner. This pass rebuilds the
whole site in the approved mock system, "the workbench ledger"
(~/workspace/file-toolkit/design-mock/, DESIGN.md tokens locked), plus
the owner's three live-use fixes (OWNER-FIXES.md) and the playful
amendment of the same day. Owner approved the mock and logo concept B
("Ok, go live", 2026-11-08 10:45 PT). Nothing here is deployed or
pushed; the main agent deploys after the owner sees the screenshots.

### What changed, per surface
- TYPE, ACTUALLY LOADED: the old skin named Fraunces and Archivo but
  shipped no @font-face at all, so the live site rendered fallbacks.
  The reskin self-hosts the real faces in public/fonts/ (IBM Plex Sans
  variable, IBM Plex Mono 400/500/600, Fraunces variable, Mansalva
  latin + latin-ext for handwritten notes) and declares them in
  src/styles/global.css. Body is Plex Sans, display is Fraunces, every
  number and file fact is Plex Mono with tabular figures.
- TOKENS: global.css rewritten to the locked set (paper #faf6ee,
  paper-2 #f2ead9, ink #1b2634, ink-2 #46536a, line #d9d1bd, ONE accent
  safety orange #d9551e with accent-deep #b03e0f, success #1e7a46).
  Radius 0, shadows none (the only box-shadow in the built CSS is a
  `none` reset), 3-5% SVG grain on the body. The old .ticket class is
  now a plain ruled ledger panel; .ticket-soft is a hairline block;
  the job ticket survives ONLY as the result receipt (see below).
- LOGO: concept B, the bench block, built as real vector data: the
  bold lowercase b is the actual IBM Plex Sans Bold glyph path,
  extracted from the official font with fontkitten
  (tools/make-logo.mjs), in a hard square. src/components/LogoMark.astro
  renders it inline; public/favicon.svg plus PNG fallbacks
  (16/32/180/192/512, via sharp) replace the old data-URI favicon.
  The wordmark is set in type (lowercase "benchzy" + mono tagline),
  per the mock. The mark also appears big: 88px in the homepage hero,
  56px at the head of the four hub pages, 40px in the All tools
  section head.
- MASTHEAD + FOOTER (Base.astro): mock structure — mark, wordmark,
  tagline, nav links ruled off with hairlines (nav becomes a ruled
  second row under 820px; the mock left mobile nav unsolved, this is
  our working answer). Footer keeps its three standing columns and
  gains the mono fine-print row: "BENCHZY — THE FILE WORKSHOP /
  FILES SENT TO A SERVER: 0" (ES/PT-BR drafted to match, same
  pending-review status as the rest of the locale chrome).
- HOMEPAGE (index.astro) rebuilt to mock-home.html: 7/5 hero with
  kicker, Fraunces headline, lede, and the WORKING flagship — the full
  background-removal tool (BgTicket gained stack/flush variants) sits
  in the hero, not a picture of it. Facts ledger aside (files sent to
  a server: 0, sign-up: none, no counter, tool pages working today
  counted from the page's own data: 22, price). One Mansalva margin
  note ("start here, it is free"). The tool ledger lists all 22 live
  doors as whole-row links with Ready / Open -> metas and one
  Coming later row (Convert and resize); counts in the section head
  are computed from the same data. Then the free-means points as ruled
  rows, the 3 steps as ledger rows, the workbench block (ids wb-jobs /
  wb-empty / wb-clear unchanged, renderJobs untouched), and a new
  Questions section. Because the homepage now runs a tool, the SEO
  audit counts it as a tool page: it carries a HowTo transcribed from
  the flagship's visible labels and an FAQPage transcribed from that
  visible Questions section, per the site's own milestone-5 rule.
- TOOL PAGES: kickers purged of ticket language ("Job ticket · PDF
  bench" -> "PDF tools", etc.). Every result block is now THE RECEIPT:
  receipt-white panel, hard border, the Done mark, and a perforated
  tear edge along the bottom (radial-gradient hard stops), appearing
  only where a result is delivered. Batch result rows are ruled
  ledger lines. Trays are paper-2 panels with a dashed inner frame
  that lights up in accent on drag-over.
- HUBS (tools, pdf-tools, image-tools, background-removal): listings
  are one bordered ledger per family with whole-row link rows (name,
  Ready + Open -> meta, note) — the 22 repeated orange buttons the old
  rows carried are gone, per DESIGN.md's one-primary-action rule;
  planned rows read "Coming later". The never list on
  what-free-means is one ruled ledger block. Big bench-block mark at
  each hub's head.
- THE STAMP, RECONCILED: DESIGN.md bans stamps; the owner's later
  playful amendment explicitly asks for "the result stamp lands".
  Exactly one stamp survives — the Done mark on result receipts —
  restyled square, rotated -2.5deg, landing once at 220ms when a
  result appears. All listing/status stamps are gone.
- MOTION (bundle doc 05): 150-250ms, ease-out, state only — receipt
  fades/slides in (220ms), stamp lands (220ms), tray reacts on
  drag-over (150ms), file-loaded banner pops (180ms), ledger rows
  highlight with an accent edge on hover. A global
  prefers-reduced-motion block flattens all of it. Byte counters do
  NOT tick: the proof gates read spec values the moment a file lands,
  and an animated count could make those reads flaky; the motion
  budget was spent on state changes instead. Recorded as a deliberate
  deviation from the amendment's example list.
- OG IMAGE (tools/make-og-image.mjs, public/og.png regenerated): the
  ledger card — paper + grain, hard frame, bench-block mark, Fraunces
  wordmark, mono fact lines, one Mansalva note ("no tricks at the
  download button, ever"), footer rule "FILES SENT TO A SERVER: 0".
  Set in the site's real self-hosted fonts.

### Owner fix 1 — plain-words loading messages
- Background tool (all 3 locales, src/locales/bg.js): the first
  loading line now says what it is and why: "Loading the removal
  program (44 MB, one time only). It runs in your browser; your photo
  is never uploaded..." Progress lines say "Loading the removal
  program: X of Y MB (piece i of n)..."; the spec row reads "44.3 MB
  in 11 checked pieces; loads once, when you press start". The exact
  done strings ("Done." / "Listo." / "Pronto.") are untouched and the
  verify gates on them pass. ES/PT-BR lines are parallel drafts under
  the same pending-human-review status as all locale strings.
- Batch background tool: "Loading the removal program (44 MB, one
  time only)...", per-file status "Removing the background from
  NAME...", spec "loads once".
- Compress image / PDF / OCR: "Loading the image/PDF/reading program
  (about N MB, one time only). It runs in your browser; your file is
  never uploaded..." Jargon removed from result notes ("smallest this
  tool can reach", "even at the strongest setting", "in our tests").

### Owner fix 2 + the 13:34 PT purge order — "on the bench" is gone
- Statuses: every listing/status stamp replaced by plain words —
  "Ready" (success green, mono) for live tools, "Coming later" for
  planned ones. No status anywhere renders "On the bench" (confirmed
  in the built output, below).
- Phrase purge (owner order 2026-11-08 13:34 PT, folded into this
  pass): the phrase and its family ("on the bench", "on our bench",
  "on our test bench", "the same bench", "this bench", "the bench
  does/measures/reads...", "Chain the benches") are rewritten in
  plain words in ALL user-facing copy — every page in src/pages,
  src/components, rendered script strings, meta descriptions, HowTo
  schema texts, and public/llms.txt (75 sentences/lines rewritten;
  e.g. "On the bench, 25 files merged in 71 milliseconds" -> "In our
  tests, 25 files merged in 71 milliseconds"; "Chain the benches
  together" -> "Chain the tools together"; "verified on the bench" ->
  "verified in our tests"). Untouched, per the order: the Benchzy
  brand name, "workbench" as a noun (incl. the Your workbench block),
  code comments, file names, and this file's earlier history.
- DIST CHECK (the order's own test): `grep -ri "n the bench" dist/`
  returns 0 matches across all built HTML/JS/CSS/txt.

### Owner fix 3 — the file-loaded shout
- workbench.js: wireTray / wireTrayMulti (and the batch-merge folder
  picker) now fill a banner BEFORE the tool's callback runs. Every
  tool page carries <p class="file-loaded" data-loaded-for="<input
  id>"> under its tray (23 banner elements in source, rendering on
  27 built pages, incl. both interleave trays and the homepage
  flagship; ES/PT-BR labels localized via data attributes). Rendered: "File loaded:" + the file name BOLD in
  safety orange #d9551e + the size in mono, on a receipt-white bar
  with a 6px accent edge. Multi-file picks read "Files loaded: first
  name +N more · total in all". Proven in
  verify/screenshots/compress-pdf-loaded-ledger.png.
- One real bug found by the screenshots and fixed in this pass: the
  banner's display:flex is unlayered CSS and outranked Tailwind's
  layered `hidden`, so an empty banner box showed before any pick.
  `.file-loaded.hidden { display: none }` now states it explicitly.

### Audit-tool fix (measuring tool, not a goalpost)
- verify/seo-audit.mjs derived the homepage's route as "//" once the
  homepage became a tool page, so its schema lookup missed JSON-LD
  that is verifiably present in dist/index.html. The derivation is
  fixed and commented in place; the requirement (HowTo + FAQPage on
  every tool page, homepage included) is unchanged and now passes.

### Verification
- VERIFY RESULTS (final dist, after the CSS fix, hub conversion, purge and the
  13:49 PT copy order): full verify suite run to a complete log — all 38 pages
  reported "errors: 0 failed: 0"; witness "Job done" with "Network requests
  during the job: 0"; service worker caches ["benchzy-v1"], offline reopen ok;
  compress-image blob 199,856 byte-exact; merge 6,674 B; preset-pdf-200k
  90,117 B; preset-image-50k 50,112 B; OCR gates pass (decimalDropped expected);
  background Done./Listo./Pronto. exact, times include 1200 x 900, noSubject
  false; batch gates: batch-images 199,856, batch-convert WebP 251,730,
  batch-merge 6,674, batch-bg 936,993; workflows persisted: true; sign 10
  pages / 1 image; strong honest-unchanged text; interleave order ok; flatten
  "3 form fields baked", 0 fields left. SEO audit on the final dist: ALL
  CHECKS PASSED, 0 warnings (38 pages, HowTo on 26 tool pages incl. homepage,
  orphans 0, depth <= 3). A focused final-dist sweep (verify/sweep-m7.mjs)
  re-checked all 38 routes after the last edits: 0 console errors, 0 page
  errors, 0 failed requests; the empty .file-loaded banner computes to
  display:none with no layout box; homepage .job-row backgrounds all compute
  transparent (the alternating tint seen in an early screenshot was a
  downscale artifact, not a rule). Dist grep for "n the bench"
  (case-insensitive) on the final build: 0 matches. Screenshots retaken on the
  final dist (verify/screenshots/, "ledger" in the names): home desktop,
  home mobile, batch-compress-pdf, remove-background, tools hub,
  compress-pdf loaded state — all reviewed; hubs show whole-row links with no
  orange buttons, and no empty banner boxes anywhere.
- OWNER COPY ORDERS 2026-11-08 13:49 PT, corrected 13:56 PT (download framed
  as the privacy protection; the 13:56 wording REPLACES the 13:49 framing on
  the same surfaces, and the word "privacy" appears by name): background tool
  intro in EN/ES/PT now carries "The download is how we protect your privacy.
  Our program comes to your device and does the work there, so your photo
  never leaves it. Other sites do it the other way round: you send them your
  photo." (ES "privacidad" / PT "privacidade" parallels drafted in-house,
  same pending-review status as the rest of those pages). The loading line
  in all three locales now reads "Loading the tool program (44 MB, one time
  only). It runs in your browser to protect your privacy: your photo never
  leaves your device." The batch background tool's loading line carries the
  same wording (plural "photos"). /what-free-means/ "Why it can be free" now
  carries: "We work this way to protect your privacy: the program travels to
  your browser. Your file never travels anywhere." Verified in the final
  dist: new wording present on all surfaces, no trace of the 13:49 framing,
  SEO audit still ALL CHECKS PASSED, final sweep 38 routes / 0 errors,
  "n the bench" grep still 0, screenshots retaken. (The one "whole trick"
  string left in dist is a different, older sentence on /presets/ about why
  jobs cost the site nothing; it is not one of the ordered surfaces.)
  Also fixed in passing: the four ES/PT background-family kickers still said
  "Orden de trabajo / Ordem de serviço" (job-ticket wording); now plain
  labels.
- SEO AUDIT: all checks passed, 0 warnings (38 pages, sitemap 38,
  hreflang 24, tool pages with HowTo: 26 incl. the homepage, orphans
  0, max click depth 3).
- Screenshots in verify/screenshots/ (all carry "ledger"):
  home-desktop-ledger.png, home-mobile-ledger.png,
  batch-compress-pdf-ledger.png, remove-background-ledger.png,
  tools-hub-ledger.png, compress-pdf-loaded-ledger.png
  (the file-loaded shout, proven). Shot by verify/screenshot-ledger.mjs.

### Pre-ship anti-slop checklist (bundle checklists/pre-ship-anti-slop.md, run 2026-11-08)
P0 (must be No):
- Inter/Geist/Space Grotesk primary typeface? NO — deliberate pairing
  Fraunces / IBM Plex Sans / IBM Plex Mono, self-hosted; the shipped
  CSS names no other UI faces.
- Purple/indigo/violet gradients? NO — no color gradients anywhere;
  CSS gradients exist only as hard-stop patterns (the transparency
  checkerboard, the receipt perforation) in ink/paper tones.
- Row of exactly three identical feature cards? NO — steps and points
  are ruled ledger rows in one bordered block.
- Floating announcement pill above the hero? NO.
- Glassmorphism or neon glow? NO — no backdrop filters, no glow; the
  only box-shadow in the built CSS is a `none` reset.
- Emoji as primary UI icons? NO — zero emoji in the built HTML
  (scanned); icons are the bench-block mark and text.
- Generic dual-CTA centered hero? NO — asymmetric 7/5 hero whose
  entry is the working flagship tool itself.
High severity:
- More than one competing accent? NO — one accent (#d9551e) plus its
  own deep shade for text/hover, and the locked success green used
  only for Ready/verdict states.
- Body measure regularly over ~75 characters? PARTIAL, recorded:
  prose columns are capped at max-w-2xl (672px) as in the previous
  skin, which is ~80 characters worst case in Plex Sans; ledes and
  notes mostly sit well under. Not changed in this pass.
- Alternating section backgrounds for rhythm? NO.
- Soft shadows + large radius on every card? NO — radius 0 site-wide,
  no shadows, no card grids.
- Perfect symmetry with no offset? NO — 7/5 hero, offset facts
  ledger, big mark devices.
- Hover-only interactions required for core tasks? NO — every core
  action is click/tap; hover only adds row highlighting.
Product-specific (adapted to a file-tools site):
- Latest job immediately visible / the tool one glance away? YES —
  the tray is the first element on every tool page and the flagship
  works in the homepage hero.
- Numbers in tabular figures? YES — Plex Mono + tabular-nums on spec
  ledgers, receipts, facts and batch rows.
- Dense lists rather than cards for history? YES — workbench job
  notes render as spec ledger rows.
- Spanish support first-class? PARTIAL, pre-existing and recorded:
  ES/PT-BR tool pages are complete with localized chrome and banners,
  but the strings remain PENDING HUMAN REVIEW (TRANSLATIONS.md) and
  must not be promoted until reviewed.
Motion & polish:
- Reduced motion respected? YES — global kill block; every animation
  is CSS and covered by it.
- Transitions short (<=250ms) and purposeful? YES — 150-220ms,
  state changes only.
- Loading states use skeletons? NO, deliberately: tools report in
  plain-words status lines (owner fix 1) inside a fixed panel layout,
  so nothing jumps; no skeleton screens.
- Empty and error states intentional? YES — dashed empty-workbench
  note, no-subject panel, honest-failure result receipts that return
  the original file.
Final human test:
- Would five AI tools produce this page from a generic prompt? NO —
  the result receipt with perforated edge, the mono byte ledgers, the
  bench-block mark as the typeface's own glyph, and the handwritten
  margin notes are specific to this product.
- At least one product-specific design decision? YES — the receipt;
  also the file-loaded shout and the "FILES SENT TO A SERVER: 0"
  fine-print footer.
- Intentional with JS disabled / slow connection? PARTIAL, inherent:
  all copy, ledgers and links render statically; the tools themselves
  are JavaScript programs and cannot run without it.

### Honest leftovers
- Mobile nav: the mock left it unsolved; ours is a working ruled
  second row, not a designed mobile menu.
- White text on the accent button measures ~3.99:1 (already noted at
  mock stage): passes for large/bold button text, not for small body
  text; accent-deep is used wherever the accent carries small text.
- The homepage hero deviates from the mock in one way: the mock's
  hero tray was a static sketch; ours is the full working tool
  (stacked variant), so the hero column runs longer than the sketch.
- Nothing deployed, nothing pushed. Deploy is the main agent's step
  after the owner sees the screenshots.
- MILESTONE 7 (RESKIN) DEPLOYED (2026-11-08, owner approved from screenshots): Wrangler Direct Upload from inside dist (141 files), deployment a527bac4.benchzy.pages.dev. All 38 sitemap URLs verified 200 from the public side; live spot checks: privacy-download wording present on /remove-background/ and /what-free-means/, "Ready" statuses on the homepage (23 instances), "on the bench" absent from live home and background pages. IndexNow retried for the reskin: api.indexnow.org 403 again, Bing endpoint dropped the connection (0 accepted; consoles remain the discovery route). GitHub snapshot of the milestone-7 tree: PENDING (snapshot helper not rediscovered this session; append the entry to ~/workspace/benchzy-build.muse-github-snapshot-sync.json when the push runs).

## Milestone 8: the round-1 user-test fix round (2026-11-08, LOCAL ONLY, not deployed, not pushed)

Built from the ranked fixes in the round-1 simulated-user panel
(~/workspace/file-toolkit/user-tests/round-1-2026-11-08/ROUND-1-SUMMARY.md).
The milestone-7 design system is unchanged (same locked tokens, ledger
rows, one orange accent, self-hosted fonts); every milestone-5 SEO
system still works. Page count: 38 -> 43 content pages (45 files in
dist including the 2 static redirect pages). Working tools still 9;
tool pages 25 -> 26 (the homepage hero counts as before; no new tool).

### The ten items, as built
1. PRIVACY PAGE. New /privacy/, footer-linked on every page (all three
   locales; ES/PT labels Privacidad/Privacidade). Content is present
   tense and build-true: routine request logs only; no accounts exist;
   no upload exists anywhere; NO analytics or ad script ships today
   (verified by grep over src/ and public/: none). Local storage named
   concretely (workbench file names/sizes, presets, workflow steps;
   keys benchzy-jobs / benchzy-presets / benchzy-chains) plus the
   service-worker program cache, with clear-site-data instructions.
   Ads: none served yet; the network will be named on the page before
   the first ad runs; an ad can never see a file, stated as how the
   site is built. "What we do not protect you from": the device, the
   visitor's extensions, the network seeing the visit, the file after
   sharing. The sentence "Page counts may be kept in aggregate" is
   deleted everywhere (check-it-yourself families row rewritten); the
   audit now fails if it ever reappears. Consistency fixes in the same
   pass: the homepage FAQ and facts ledger and the promise page no
   longer say ads pay for the site in the present tense ("will be paid
   for by ads; no ads run yet"), matching this page.
2. 44 MB BLOCK + CANCEL. The M7 block stands; added data-plan words
   (counts against mobile data, Wi-Fi better first time, a slow
   connection can take a minute or more) to the EN/ES/PT BG intros,
   the full-resolution FAQs and the batch BG page. CANCEL is real:
   both loaders (remove-bg.js own loader, lib/bg-engine.js for batch)
   take an AbortController; fetched-and-checked pieces are KEPT in
   page memory and a later run resumes from them, and the status line
   prints exactly that ("Loading stopped. N of 11 pieces are already
   here and are kept..."). A Cancel button shows only during the load
   (see the CSS note under "Defects found" below). Verify gates cancel
   mid-load against a server slowed to 700 ms per chunk: both tools
   stopped at 3 of 11 pieces, page fully usable, resume completed.
3. ES/PT ROUND. (a) ES re-localized to neutral Latin American Spanish:
   ordenador de sobremesa -> computadora de escritorio, cristal ->
   vidrio, en directo -> en vivo, ¿Adónde -> ¿A dónde, maquinaria
   deleted, nivel de pago / resultado verdadero -> plan pago /
   resultado a tamaño completo, el sujeto -> la figura everywhere
   incl. island messages, bandeja tray lines -> "aquí". (b) PT:
   assunto -> figura everywhere incl. error messages; footer heading
   "Debaixo do balcão" -> "Nos bastidores"; the alternative page's
   "O remove.bg fecha o seu site" (read as Benchzy closing) -> "O
   próprio site do remove.bg fecha"; nível pago -> plano pago; uso
   privado -> uso pessoal; na bandeja -> aqui. One "uso privado"
   remains, deliberately: the ES full-resolution FAQ states remove.bg's
   terms in correct Spanish. (c) /what-free-means/ and
   /check-it-yourself/ translated in full: /es/que-significa-gratis-aqui/,
   /es/compruebalo-tu-mismo/, /pt-br/o-que-significa-gratis/,
   /pt-br/confira-voce-mesmo/ (note: PT routes live under /pt-br/ like
   all PT pages). Hreflang wired both ways on all 12 cluster pages;
   sitemap hreflang links 24 -> 48; the localized pages compute the
   same build score (9 / 26 / 43, matching the English page); the
   witness script's own strings are localized per page language. The
   footer trust links on ES/PT pages now point at the localized pages.
   (d) The four promises render in-language beside the tray and above
   the download button on ES/PT tool pages (bg.js ui.promises), and the
   download buttons were already in-language. (e) /es/quitar-fondo/ and
   /pt/remover-fundo/ are static redirect pages (canonical + meta
   refresh to the real localized tool pages, noindex), kept out of the
   sitemap and asserted separately by the audit. TRANSLATIONS.md
   updated: resolved register items marked, 6 new at-risk groups added
   (cancel strings, data-plan sentences, promises + HEIC note, the four
   trust pages + witness strings, footer labels, steps strips and
   redirect lines). All ES/PT remains in-house draft, PENDING HUMAN
   REVIEW, as before.
4. PAGE SHAPE. A steps strip (new StepsStrip component) sits at the
   top of all 26 tool pages: one "who is this for / the everyday job"
   sentence plus the visitor's 3 steps, taken from each page's own
   HowTo. Interleave's who-line is its FAQ's duplex sentence.
   Warnings at the moment of action: sign-pdf carries the
   typed-signature-is-not-your-hand note directly under the Type
   control; flatten-pdf carries the signature-field warning in plain
   words directly above the run button. Sign and Flatten were verified
   already present in the homepage PDF jobs ledger (no work needed).
5. BATCH NUMBERS. Real harness runs on generated fixtures (100
   distinct JPEGs, 50 one-page PDFs; verify/make-batch-fixtures.mjs):
   batch compress images 100 files -> 100 rows, 100 ZIP entries;
   batch convert images 100 -> 100 rows, 100 ZIP entries; batch merge
   PDF 50 -> one merged PDF of 50 pages; batch compress PDF 50 -> 50
   rows, 50 ZIP entries. The pages print exactly those counts
   ("tested with 100 files in one run" / "tested with 50 files in one
   run") in the tray line and the honest-limits text, with "past that,
   your device's memory is the limit"; the harness asserts the printed
   claim on each page in the same run. Bare "as many as you like" is
   gone from every tray (batch split and the single merge tool now say
   "as many as your device can hold"; they were not in the tested set
   and claim no number).
6. WORKFLOWS HONESTY. Honest limits now opens with it: background
   removal and OCR are not chain steps yet, so cut-out-then-shrink
   cannot be built today. The Starter chains section is restructured
   from bare chips into ledger rows: each chain's name (button, same
   data-starter wiring) plus its steps written out as text, present in
   the served HTML for any reader.
7. SPLIT ZIP. Every-page split now delivers ONE ZIP (the shared
   makeZip writer) named <file>-pages.zip with a primary download
   button; the per-page rows stay below for single-page takes. Page
   copy (FAQ, HowTo, limits) updated to match. Gate: the 12-page
   fixture splits to 12 rows and a ZIP of exactly 12 PDF entries.
8. COMPRESS WARNING. All three compress-PDF pages carry the warning
   in a ruled note inside the ticket, before the run button: scans are
   pictures so their text softens when squeezed; PDFs whose images are
   not JPEG may barely shrink.
9. MOBILE. Homepage: a fast lane ("In a hurry? Shrink a photo for a
   form -> exact KB, about a minute") now sits directly above the
   background hero on small screens (same content, DOM order). Tap
   targets: nav links, chips, text buttons and primary/ghost buttons
   are 48px minimum; form inputs and selects inside main are 48px too.
   Image tool pages state accepted formats in the tray, and all BG and
   image trays carry the plain HEIC note (HEIC not accepted yet; a JPG
   or PNG copy works).
10. CLAIM CUTS. "keeps running" deleted from the vs page ("Benchzy is
    independent of remove.bg."). The "biggest toolkit" hedge is gone
    from the promise page (the aim sentence and its footnote; the
    promise line "Our promise: every file job in one place." stays, as
    the audit requires). /remove-bg-alternatives/: Pixlr, Photoroom,
    Removal.ai and Pixelcut entries are now labelled on the entry as
    third-party reports, not our own tests (Playyy round-up, read 7
    November 2026); Canva's entry is labelled as the makers' own pages
    read November 2026, not a hands-on test; the intro says so too.

### Verification (final build)
- npm run build: 43 pages. verify/seo-audit.mjs: ALL CHECKS PASSED
  (45 dist routes incl. 2 redirects handled on their own terms;
  sitemap 43 locs == content set; 48 hreflang links; 0 orphans; depth
  <= 3; privacy linked on every page; aggregate sentence absent;
  computed promise score matches the independent recount 9/26/43).
- verify/verify.mjs: VERIFY DONE, exit 0. All 43 pages: zero console
  errors, zero failed requests. Every prior gate reproduces (witness
  0 requests during the job; OCR profile incl. the documented decimal
  flaw; BG in EN/ES/PT at 1200x900, 915 KB cutouts, correct statuses
  and download suffixes; compress-image 199,856 B bench result; merge,
  presets, strong, interleave order, split-by-size, flatten 0 fields;
  the whole milestone-6 block). New M8 gates all pass (split ZIP
  12/12; cancel single + batch, kept 3 of 11, resume to result; batch
  100/100/50/50 with printed claims matching; per-page privacy-link
  and aggregate gates on all 43 pages; trust-cluster language wiring
  recorded for all 6 trust pages).
- Screenshots: verify/screenshots/m8-privacy-desktop.png,
  m8-privacy-mobile.png, m8-bg-block-desktop.png (the BG page top:
  data-plan words, steps strip, tray formats + HEIC note, promises),
  m8-es-gratis-desktop.png (the Spanish promise page). Read and
  checked by eye.

### Defects found and fixed during this milestone (honest list)
- The Cancel button rendered VISIBLE at idle: the unlayered
  .btn-ghost/.btn-primary display:inline-flex silently beats the
  layered Tailwind `hidden` utility. It had been masked everywhere
  else because those anchors live inside hidden receipt parents. One
  CSS rule (.btn-primary.hidden, .btn-ghost.hidden { display: none })
  fixes the class of bug; the cancel gates now assert real visibility
  (computed display + offsetParent), not just the class.
- A first harness run crashed at the witness test: the milestone-8
  witness localization refactor left a dangling locale lookup that
  broke the script. Fixed before the green runs; the witness gate
  passes in all runs since.
- An early build broke on an apostrophe inserted into a JS string in
  batch-merge-pdf's FAQ; reworded ("the memory of your device").
- The batch-50 ZIP gate initially raced the page (saved the ZIP
  anchor before its blob href was set); the harness now waits for the
  blob href. Harness bug, not a page bug.
- One wrong-prefix slip (/pt/ for /pt-br/) in cluster wiring was
  caught by the sitemap audit showing 10 alternate sets instead of
  12 and fixed everywhere before the green runs.

### Honest leftovers
- The batch background test's second photo (the corpus realistic
  landscape) ends with the row "no clear subject found; nothing
  downloaded for this one": the model finds no clear subject in it,
  so the batch ZIP holds the one real cutout. That is the designed
  failure contract, visible in both the M6 and M8 gates.
- White-on-orange contrast and the plain mobile nav row carry over
  from milestone 7, unchanged.
- ES/PT human review is still owed before those pages are promoted;
  milestone 8 added ~6 more at-risk string groups to TRANSLATIONS.md.
- Nothing deployed, nothing pushed. Deploy is the parent agent's step.
- MILESTONE 8 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist (150 files), deployment a4d52525.benchzy.pages.dev. All 43 sitemap URLs verified 200 from the public side; live spot checks: /privacy/ serves with the do-not-protect list, the ES trust page is live, /es/quitar-fondo/ serves its redirect page, the background page carries the Cancel control and the mobile-data words. IndexNow retried for all 43: 403 again (0 accepted; consoles remain the discovery route).

## Milestone 9: protect PDF + unlock PDF behind its fidelity bench (2026-11-08, LOCAL ONLY, not deployed, not pushed)

Two new working tools on the already-shipped @cantoo/pdf-lib fork: **11 working tools, 28 tool pages, 45 pages** (was 9 / 26 / 43). Zero new download bytes: both tools run on the PDF engine every PDF page already loads. Built to the licence audit's conditions (~/workspace/file-toolkit/QPDF-AUDIT.md): AES-256 revision 6 only on protect; the audit's honest-copy rules on unlock, in spirit and mostly verbatim; credits line extended to name the fork's encryption addition under the same MIT entry.

### The unlock fidelity bench (built and run BEFORE the unlock page)

- Corpus made independently of the fork: base files built with the fork (plain text 3 pages; a filled form, name + checkbox + dropdown; a file with an attachment; a signature-field file; a 300-page file), then encrypted with **pikepdf 10.18.0** (the real qpdf binding, pip venv at /tmp/qpdfvenv; no qpdf CLI exists on this box). Scripts kept: verify/m9-make-bases.mjs, verify/m9-encrypt-corpus.py; fixtures in verify/fixtures/m9/ (+ corpus.json); results in verify/m9-bench-results.json. Test passwords are synthetic fixture values (open-pw-123 / owner-pw-456).
- Matrix: 28 cases. The text base crossed with all six handler kinds the fork claims (RC4-40 R2, RC4-128 R3, RC4-128 R4, AES-128 R4/AESV2, AES-256 R5, AES-256 R6) as an open password AND as a permissions-only password (empty user password, restrictive switches); plus form, attachment, signature and 300-page bases each under AES-128 R4 and AES-256 R6, both kinds.
- **First finding (recorded honestly): the naive flow FAILS.** Load-with-password + plain save decrypts the content, but the fork's save leaves the source's encryption dictionary AND the source's cross-reference stream object behind as orphans; the fork's own parser then resurrects /Encrypt from the stale xref-stream dictionary and refuses to reload its own output (the output also carries a phantom second trailer). Independent readers (qpdf via pikepdf, poppler/pdfinfo) treat the naive output as unencrypted and read it fine; the fork itself does not.
- **The fix (bench-proven, ships in the page):** after load, delete three classes of stale objects from the context before save: the source xref stream object (it survives parsing as a raw invalid object whose bytes are its old dictionary), any parsed /Type /XRef stream, and the encryption dictionary object (the /Filter /Standard dict carrying /V /O /U). Two implementation traps found and fixed while building it: a PDFDict's own `.dict` is its internal Map (check `instanceof PDFDict` first), and PDFName interning makes identity comparison valid. After the strip, outputs are clean for every reader including the fork.
- **Final matrix: 28 of 28 cases pass every applicable check.** Per case: opens with the visitor's password; no-password and wrong-password negative controls refuse (open-password cases); output reloads with NO password, isEncrypted false; no '/Encrypt' string anywhere in the output bytes; page count equal; pdftotext extraction EQUAL to the plaintext base; form values equal; attachment names equal; signature structure preserved (checked independently with pikepdf: Sig field present, /V is a /Sig dict, ByteRange present); 300 pages intact.
- Honest scope note on the signature fixture: it carries a signature FIELD with a placeholder /Sig dictionary (Filter, SubFilter, ByteRange, zeroed Contents), which is Adobe-style signature STRUCTURE, not a cryptographically valid signature (no certificate chain exists in a synthetic fixture). What the bench proves is that the structure survives the round trip whole; the unlock page's copy states the true general limit instead: any re-save means signatures no longer verify as untouched, in every tool. The small-file negative controls behave differently by handler and that is recorded too (pikepdf reports R2/R3 owner-only files as requiring the (empty) password; the fork still opens them via the permissions path).

### What shipped

- **/protect-pdf/** — pick a PDF (an already-protected file is named as such and refused, with the route through unlock first), type the password twice with a show/hide toggle, the no-recovery warning in a ruled note BEFORE the run button, spec rows state exactly what happens to the password ("nowhere: typed and used on this page only"). The run sets the same typed password as user and owner password with `encrypt({ algorithm: 'AES-256' })`, then verifies the output in-page (shut without the password, open with it, page count equal) before offering `<file>-protected.pdf`.
- **/unlock-pdf/** — before the tray: the two-kinds-of-password panel (an open password must be known and typed, no exceptions, here or anywhere; a permissions password on a file that already opens comes off without typing, explained as how PDF permissions work in every tool), the own-files rights line, and the privacy line (typed into the page, used inside the page, never sent anywhere). The page classifies the picked file in the open (opens / asks for a password / none) by probing with the empty password. The run is exactly the benched flow: load with the typed (or empty) password, strip the stale protection objects, save, re-open with no password and check before download (`<file>-unlocked.pdf`). Wrong password gets one plain failure line and no download; a forgotten open password gets the same answer in the FAQ. No occurrence of crack / recover-as-a-promise / unlock-any anywhere, title and meta included.
- **Pointers:** one plain line added to the Honest limits of all twelve other PDF tool pages (compress x3, merge, split, OCR, sign, flatten, interleave, batch compress/merge/split): a password-protected PDF cannot be opened by the tool; take its password off with the unlock tool first.
- **Plumbing:** 'protect-pdf' + 'unlock-pdf' added to the computed tool lists in all four places (promise pages EN/ES/PT + seo-audit), so the promise score moved itself to 11 tools / 28 tool pages / 45 pages; both doors listed on /pdf-tools/ (and the planned-line "Protect and unlock PDF (after its engine passes a separate audit)" removed, because it now has), /tools/, the homepage ledger, and public/llms.txt. HowTo + FAQ schema on both pages mirror visible text, transcribed from the pages' own labels.

### Verified

- verify/seo-audit.mjs: ALL CHECKS PASSED (45 sitemap pages, 28 tool pages with HowTo, both new pages at link depth 1, hreflang 48).
- verify/registry-shape.mjs: OK (new hub/list entries carry exactly their sibling key sets).
- Weak-crypto assertion (new, in verify.mjs): the identifier allowWeakCryptography appears ZERO times in src/ (our code never names the fork's weak-crypto flag), and the built bundle contains no enablement of it outside the fork's own refusal error-message text (the literal string inside its "Refusing to encrypt with RC4..." message).
- New browser gates in verify.mjs, all passing: (a) protect round trip on corpus test-10page.pdf — fork side: refuses with no password, refuses a wrong one, opens with the correct one at 10 pages; PDF.js side (independent reader, in the page): PasswordException with no password, PasswordException with a wrong one, opens at 10 pages with the correct one; (b) protect->unlock chain through the two pages themselves: the unlocked output's pdftotext extraction is byte-identical to the original file's; (c) unlock gates on the independent pikepdf fixtures (AES-256 R6, both kinds): wrong password refused in the open with no download offered, then the correct password finishes with text equal to the base; the permissions-only file is classified as the switch kind in the spec and finishes with the password box empty, text equal to the base.
- Full suite: VERIFY DONE, all prior gates reproducing, pages loop over all 45 routes with zero console errors and zero failed requests. Screenshots: verify/screenshots/m9-protect-pdf-desktop.png, m9-protect-pdf-mobile.png, m9-unlock-pdf-desktop.png, m9-unlock-pdf-mobile.png (plus the generic route screenshots).

### Honest leftovers

- Nothing deployed, nothing pushed. Deploy is the parent agent's step.
- The bench's corpus passwords are synthetic and printed in the bench scripts on purpose; no real file was used anywhere in milestone 9.
- Protect sets ONE password (the same value as user and owner password) and no separate permission switches; the page says so plainly rather than offering switches it does not set.
- MILESTONE 9 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist (154 files), deployment ba9cee9c.benchzy.pages.dev. Site now 45 pages, 28 tool pages, 11 working tools (protect + unlock added). IndexNow retried for all 45: 403 again (0 accepted).

## Milestone 10: photo OCR — read the words in a photo (2026-11-08, LOCAL ONLY, not deployed, not pushed)

One new working tool on the already-shipped Tesseract.js engine (no new
engine): **12 working tools, 29 tool pages, 46 pages** (was 11 / 28 / 45).
Route: /ocr-image/, following the site's own convention (/ocr-pdf/ for the
scan reader; script src/scripts/ocr-image.js, registered as the 'ocr-image'
engine in all four TOOL_ENGINES lists: the three promise pages + the audit).

### What shipped
- /ocr-image/ — pick a photo or screenshot (JPG/PNG/WebP; the tray carries
  the standing HEIC note), the words are read in the browser, and the text
  lands in an editable box with Copy and Download (.txt) buttons; both use
  the text exactly as it stands in the box, visitor fixes included. Steps
  strip + who-it-is-for at the top, file-loaded banner, spec ledger with
  the reading plan printed before the run, receipt result with the Done
  stamp, HowTo + FAQ schema transcribed from the page's own text.
- Languages: English, Spanish and Portuguese recognition, selectable in a
  "Words are in" control. Only eng.traineddata was vendored before this
  milestone; spa.traineddata (2,294,433 B, sha256 6f2e04d0...) and
  por.traineddata (1,982,756 B, sha256 c4932b93...) were added from
  tessdata_fast (Apache-2.0, the same licence posture as the English data
  and the core). Cost: +4.28 MB of shipped assets, fetched ONLY when a
  visitor picks that language (the worker loads its language on demand);
  the default English path downloads nothing new. The credits line now
  names all three languages' trained data, because the shipped data set
  changed.
- Honest copy, same discipline as /ocr-pdf/: the engine's 96.1% at
  300 DPI bench figure and this page's own measured 99% on its clean test
  picture, both labelled; the money warning carried over (check every
  figure with a decimal point; 124.50 was read as 12450 on the clean PDF
  bench page); printed text only, stated plainly (handwriting: fragments
  or nothing, no promise, FAQ included); the privacy-download paragraph
  ("The download is how we protect your privacy...") in How it works and
  in the loading line.
- Cross-links both ways: /ocr-pdf/ intro now points photo/screenshot
  visitors here; this page's intro points scanned-PDF visitors back.
  Listings: image-tools hub, /tools/ Image jobs, homepage Image jobs
  ledger, public/llms.txt. Sitemap picked the page up from the page files
  on its own; audit depth for /ocr-image/ is 1.

### The small-image bench (run BEFORE the reading plan was fixed)
Fixtures are rendered pictures of a known invoice text
(verify/m10-texts.mjs, m10-make-fixtures.mjs): big 2550 px wide at
300 DPI, mid 1400 px, small 800 px, plus two degraded variants made the
way phones/portals degrade pictures (downscale blur + JPEG re-encode).
Character accuracy against the known string, engine read as picked vs
enlarged through the page's own smoothed-canvas transform:
- big clean: 99.21% as picked.
- mid clean (1400 px): 98.82% as picked, 98.62% at 2x — enlarging cost.
- small clean (800 px): 99.61% as picked; 98.82 / 99.61 / 98.82 at 2/3/4x.
- degraded (800 px, JPEG q55): 99.80% as picked; enlarging cost at
  every factor (99.01 / 99.41 / 99.21).
- degraded hard (560 px, JPEG q35): 94.28% as picked; 98.42 / **99.01** /
  98.42 at 2/3/4x — enlarging 3x gained 4.7 points.
Verdict, and the shipped rule: enlarging is a tax on clean pictures and
a rescue on genuinely rough small ones. The page enlarges ONLY pictures
under 750 px on the long side, by 3x (the winning factor, and the factor
that tied rather than cost on the clean 800 px case); the spec and the
pre-run status print the plan and the 94% -> 99% bench line. Very large
pictures are shrunk to a 6,000 px long-side ceiling before reading.
Scripts + results kept: verify/m10-bench.mjs, m10-bench-degraded.mjs,
m10-bench-degraded-hard.mjs (+ their results JSONs).

### Verified (final build)
- npm run build: 46 pages. verify/seo-audit.mjs: ALL CHECKS PASSED
  (46 sitemap locs == content set, 29 tool pages with HowTo + FAQ,
  /ocr-image/ at depth 1, promise score matches the independent recount
  12 / 29 / 46). verify/registry-shape.mjs: OK.
- verify/verify.mjs: VERIFY DONE, exit 0. All 46 routes load with zero
  console errors and zero failed requests; every prior gate reproduces.
  New M10 gates, all passing:
  (a) the clean fixture through the real page UI reads at **99.21%
  character accuracy** against its known string (gate was >= 95%; the
  number matches the standalone bench exactly);
  (b) the rough small fixture (560 px JPEG) exercises the tip path —
  status and spec both print the enlarge plan before the run — and reads
  at **99.01%**, against 94.28% for the same picture read as picked;
  (c) after a hand edit typed into the box, Copy puts the shown text on
  the clipboard byte-for-byte and the .txt download's bytes equal the
  shown text byte-for-byte;
  (d) zero console errors on the new route in the full pages loop.
  Language gates: the Spanish fixture read with the Spanish data scores
  100% character accuracy and the Portuguese fixture 100% against their
  known strings (clean renders; recorded as fixture results, not as a
  field claim — the page makes no per-language accuracy claim).
- Screenshots: verify/screenshots/m10-ocr-image-desktop.png and
  m10-ocr-image-mobile.png, taken with a result on the page; read by eye
  (ledger system, file-loaded shout, spec, receipt, limits all as built).

### Defects found and fixed during this milestone (honest list)
- The first full-suite run failed the copy gate (download was
  byte-exact, copy was not): the harness granted clipboard permission
  under names this puppeteer build does not know ('clipboard-read-write'
  throws Unknown permission; it accepts 'clipboard-read' /
  'clipboard-write'), and the grant call sat in a try/catch, so the
  readback compared against an ungranted clipboard. Harness defect, not
  a page defect: a focused probe with the right names showed the page's
  copy byte-exact (550/550 chars), the harness was fixed, and the
  re-run is the green one above.

### Honest leftovers
- Nothing deployed, nothing pushed. Deploy is the parent agent's step.
- The fixture texts are clean renders in DejaVu Sans; real phone photos
  of real paper will read worse, which is what the page copy says.
- The ES/PT recognition options ship data only; no localised photo-OCR
  page exists (the site's localised set remains the background-removal
  family and the trust pages), and no human review of anything was
  needed or claimed here.
- MILESTONE 10 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist, deployment 70987c07.benchzy.pages.dev. Site now 46 pages, 29 tool pages, 12 working tools (photo OCR added; harness-measured 99.21% character accuracy on the clean fixture; ES/PT recognition data vendored, +4.28 MB downloaded only when picked). IndexNow retried for all 46: 403 again (0 accepted).

## Milestone 11: resize image + batch resize + the six convert pair doors (2026-11-08, LOCAL ONLY, not deployed, not pushed)

### What shipped
- NEW TOOL /resize-image/ (src/scripts/resize-image.js on the shipped
  lib/image-core jSquash core; two helpers added to the core: hasAlpha
  and flattenOnto, used by both new islands). Resize by pixels (width
  and/or height; aspect lock ON by default — one side alone follows the
  photo's shape, both sides with the lock on fit inside the frame, lock
  off forces the exact frame and the page says it stretches), by
  percent (25 / 50 / 75 chips or any typed value), and by presets that
  are stated truthfully: Passport photo 413 x 531 (35 x 45 mm at
  300 DPI), US passport 600 x 600 (2 x 2 in at 300 DPI), Square post
  1080 x 1080, Portrait post 1080 x 1350, Story 1080 x 1920, Video
  thumbnail 1280 x 720, Full HD 1920 x 1080, Long side 1600 (fits the
  frame 1600 x 1600). Output format: the photo's own, or picked JPG /
  PNG / WebP; the background picker appears when the output is JPG.
  The receipt prints dimensions and bytes before and after; enlarging
  is labelled on the live output line AND on the receipt ("the file
  grows, the sharpness does not. No detail is added."); the word
  "enhance" appears nowhere. Settings persist per visitor (preset slot
  resize-image).
- BATCH DOOR /batch-resize-images/ (third mode on the shipped
  batch-image island): one size for a whole folder (width, height, or
  a frame both ways), every photo keeping its own format and its own
  shape inside the frame, one ZIP out (benchzy-batch-resized.zip).
  The page prints "tested with 50 files in one run" and the harness
  ran exactly 50 (gate below).
- SIX CONVERT PAIR DOORS, pages on the shipped convert engine (new
  island src/scripts/convert-image.js drives the same image-core the
  batch convert page runs; shared ticket component
  src/components/ConvertDoor.astro; every door page imports the script
  itself so the build counts the page, per the counting rule):
  /png-to-jpg/, /jpg-to-png/, /webp-to-jpg/, /jpg-to-webp/,
  /png-to-webp/, /webp-to-png/. Each is written for its own direction
  (what it is for, what it gains and loses). The alpha truth is stated
  before the run on both doors that end in JPG: transparent parts are
  painted over a visitor-picked background (white default, black chip,
  any colour via the picker), and the receipt says when it happened
  and over which colour. JPG to PNG and WebP to PNG state plainly that
  the picture does not improve and the file grows. A file dropped at
  the wrong door is named and pointed at the doors that start from
  its own format, as links.
- Copy discipline on all eight pages: StepsStrip (steps + who it is
  for) at the top, the file-loaded banner (workbench wiring), the
  privacy-download wording in the loading line of both new islands
  and in every door's How-it-works ("The download is how we protect
  your privacy..."), honest limits sections, FAQ + HowTo transcribed
  from the visible text.
- Plumbing: image hub gained all eight rows (and the resize line left
  the hub's coming-later list); /tools/ Image jobs gained eight live
  rows; the homepage Image jobs family replaced its one coming-later
  row with the eight live rows (its computed count now reads 33 ready,
  0 coming later); compress-image links the resize page for
  pixel-dimension doors; batch-convert links all six single-file
  doors; llms.txt gained eight entries; the computed counts moved in
  all four counting places (what-free-means EN/ES/PT + seo-audit
  lists): TOOL_ENGINES += resize-image ONLY (the doors are pages, not
  tools), PAGE_SCRIPTS += convert-image.

### Counts after this milestone (build-computed, seo-audit recounted)
- 54 pages (was 46), 37 tool pages (was 29), 13 working tools
  (was 12). Sitemap 54 locs, 48 hreflang links unchanged and valid.

### Verification (all local, against dist/)
- npm run build: 54 pages. verify/registry-shape.mjs: OK (image hub
  live 15 entries, tools.astro Image jobs 13 entries, shapes exact).
  verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings (54 locs == the
  content set, 37 tool pages with HowTo + FAQ, every new route at
  depth 1, no orphans, biggest/freest wording still only on the
  promise page, the killed aggregate sentence absent everywhere).
- verify/verify.mjs: VERIFY DONE, exit 0. All 54 routes load with
  zero console errors and zero failed requests; every prior gate
  reproduces (compress-image blob 199,856 B; merge 6,673 B; batch
  100 / 100 / 50 / 50; witness 0 requests; protect/unlock round trips
  and refusals; M10 OCR 99.21% big, 99.01% rough small, ES 100%,
  PT 100%). Full log: verify/m11-verify-run.log; machine record:
  verify/results.json (m11Resize / m11Flatten / m11Doors /
  m11BatchResize50). New M11 gates, all passing:
  (a) resize the 4000 x 3000 corpus photo four ways and decode the
  actual output blobs: locked width-only 1000 -> 1000 x 750; locked
  height-only 600 -> 800 x 600; percent 25 -> 1000 x 750 (byte size
  identical to the width-only run, 186,977 B, as it should be: same
  target, same settings); lock off, 1000 x 1000 typed -> exactly
  1000 x 1000 out;
  (b) the transparent fixture (verify/fixtures/m11/alpha.png, made by
  verify/m11-make-fixtures.mjs) through /png-to-jpg/ with the
  background picked as #336699: the output's corner pixel reads
  (51, 103, 153) against the picked (51, 102, 153), and the opaque
  centre reads (223, 49, 48) against the fixture's (224, 49, 49):
  flattened on the picked colour, picture intact;
  (c) each pair door converts its fixture and the output's magic
  bytes match the door (JPG FF D8 FF; PNG 89 50 4E 47; WebP RIFF..
  WEBP) — five doors gated directly here, PNG to JPG gated in (b)
  with its JPEG type and dimensions asserted;
  (d) batch resize ran 50 images (the first 50 of the batch-100
  corpus) at a 320 px width: 50 result rows, ZIP entries == 50 ==
  the printed claim, first row 900 x 675 -> 320 x 240;
  (e) zero console errors on all routes at the new total of 54
  (the pages loop), plus zero inside every M11 gate.
- Screenshots: verify/screenshots/m11-resize-image-desktop.png,
  m11-resize-image-mobile.png (result on the page: the forced
  1000 x 1000 frame, receipt printed), m11-png-to-jpg-desktop.png,
  m11-png-to-jpg-mobile.png (the flattened fixture visible: red block
  on the picked blue, receipt naming #336699). Read by eye: ledger
  system, banner, spec, receipt, limits all as built, mobile stacks
  clean.

### Defects found and fixed during this milestone (honest list)
- The first harness draft for gate (a) waited on the wrong receipt
  element and the wrong dimension separator; caught by reading the
  shipped island before the run, and the gate was rewritten to wait
  on the one signal that cannot be stale (a NEW blob URL per run —
  the percent case lands on the same dimensions as the width-only
  case, so receipt text alone could have passed on the previous
  run's output). The batch-row assertion was corrected the same way
  (rows read "900x675 to 320x240", no arrow) before the green run.
  No page defects were found by the gates.

### Honest leftovers
- Nothing deployed, nothing pushed. Deploy is the parent agent's step.
- The resize island re-reads and re-encodes on every Resize press,
  including repeat runs at unchanged settings (a fresh blob each
  time; correct, just not cached). No gate covers the wrong-door
  message interactively; it is code-read and covered by the doors'
  format checks only in the happy path.
- The six doors and the resize pages are English only, like the rest
  of the image family; the ES/PT-BR set remains the background
  cluster and the trust pages.
- Two aborted verification attempts precede the green run (a
  harness timeout bug in the first draft, then a runtime restart);
  neither touched the tree, and the green run above is a single
  complete pass from page 1 to VERIFY DONE.
- MILESTONE 11 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist, deployment dc8e0763.benchzy.pages.dev. Site now 54 pages, 37 tool pages, 13 working tools (resize added; six convert pair doors are pages on the convert engine, counted as pages). IndexNow retried for all 54: 403 again (0 accepted).

## Milestone 12 — the PDF extras family (2026-11-08, LOCAL ONLY, not deployed)

Four new tools on the shipped @cantoo/pdf-lib fork, one page each,
following the milestone-9 page pattern exactly (steps + who-it-is-for
at top, file-loaded banner, spec panel, receipt with the landed
stamp, honest limits ending in the unlock pointer, settings kept in
the bench's own preset slots):

- /rotate-pdf/ — turn every page or one page range by 90/180/270.
  The turn is ADDED to each page's own rotation and saved as the
  page setting; the page copy states the plain truth in one
  sentence: rotation is a setting the file carries, the picture on
  the page is not redrawn. Output re-opened and the turn checked on
  every stamped page before the download is offered.
- /pdf-page-numbers/ — numbers drawn onto the pages themselves
  (stated plainly: part of the page, like flatten). Positions:
  bottom centre / bottom outside corner (right on odd display
  numbers, left on even, stated on the page) / top centre. Formats
  "Page X of Y", "X of Y", plain X; Y is the last stamped number.
  Starting number (0 allowed, for a cover page) and all/range scope.
  Helvetica 10pt in the site's ink colour.
- /watermark-pdf/ — the visitor's own short text (default DRAFT,
  40 characters max) across the pages: three sizes (stamp spans
  0.38 / 0.58 / 0.82 of the page width), three strengths (opacity
  0.15 / 0.3 / 0.5), diagonal (38 degrees) or straight, all pages or
  a range. The honest sentence is on the page, in the action note
  and in the receipt: printed into the page content; a determined
  person with a full PDF editor could still lift it off. A label,
  not a lock. Text the standard font cannot print is refused with a
  plain reason before anything runs.
- /extract-images-pdf/ — pull the pictures stored inside a PDF out
  as files (single picture downloads as itself; several arrive in
  one ZIP), with a written per-picture report under the result:
  every stored picture named, pulled or NOT pulled with its reason,
  plus a line for every page that stores none.

### Extract bench (verify/m12-bench.mjs, fixtures by m12-make-fixtures.mjs)
Walk + decode core: src/scripts/lib/pdf-images-core.js (dedupes
shared pictures by reference and reports every page each is used
on; recurses into form XObjects). Fixtures built from known pixels:
a stored JPEG + an alpha PNG + an opaque PNG over 5 pages (one
vector-only), and a "weird" file carrying DeviceGray with a Flate
PNG predictor, an Indexed palette image, DeviceCMYK, 1-bit gray, a
JPEG 2000 dummy and a fax-encoded dummy. ALL PASS in Node and
again through the real pages in the browser suite:
- Stored JPEG comes out BYTE-IDENTICAL to what went in (wrapper
  filters outside a DCT stream peeled by hand; pdf-lib's stream
  decoder refuses DCT chains).
- PNGs rebuilt pixel-equal, including the alpha PNG with its
  stored transparency (SMask) put back.
- Predictor (Flate PNG predictors 10-15 un-predicted in-core;
  pdf-lib inflates but does not un-predict), Indexed palette,
  DeviceCMYK and 1-bit gray all decode to the exact known samples.
- JPEG 2000 and fax-encoded (CCITT) pictures are NAMED SKIPS in the
  report, never silent; so are JBIG2, spot-colour (Separation /
  DeviceN), Lab and stencil masks, and draw-time masks that cannot
  be re-applied are noted on the report line. Inline-painted
  pictures and vector drawings are not stored pictures; the page
  copy and the report's per-page lines say so.
- Bench bugs found and fixed in the core before shipping: indexed
  samples were being rescaled as if they were gray levels (indices
  are palette numbers, not brightness); the TIFF predictor was a
  silent pass-through (now undone at 8 bits per component);
  colour-key mask loop bound corrected. Two fixture-side mistakes
  (a CMYK quadruple that is cyan, not red; a channel-blind compare)
  were fixed in the fixtures, not the core.

### Counts and plumbing
- Working tools 13 -> 17; tool pages 37 -> 41; site pages 54 -> 58.
  TOOL_ENGINES extended identically in what-free-means.astro, the
  ES and PT promise pages, and verify/seo-audit.mjs; the printed
  score on the promise page recounts to 17 / 41 / 58.
- Listings: /pdf-tools/ gains the four live rows and its planned
  list shrinks honestly ("Remove and organise pages", "View and
  strip PDF metadata" remain); /tools/ PDF jobs 12 -> 16 rows;
  homepage PDF family gains the four rows (liveCount computed);
  llms.txt gains four entries; sitemap auto-grew to 58 locs,
  hreflang unchanged at 48.
- registry-shape OK; SEO AUDIT: ALL CHECKS PASSED (0 warnings);
  build 58 pages.

### Verify (full suite, single green pass, VERIFY DONE)
All prior gates reproduced: byte-exact compress-image 199,856 B,
merge 6,673 B, batch 100/100/50/50, witness 0 requests, weak-crypto
mentions 0, protect/unlock round trips, photo OCR 0.9921, ES/PT OCR
1.0, resize dimensions exact, convert doors' signatures, batch
resize 50. Pages loop now covers 58 routes; ZERO console errors
anywhere in results.json. New gates:
- Rotate: output rotation values 90 on all 10 pages AND PDF.js
  rendered size swap 612x792 -> 792x612; a 2-3 range run leaves
  angles 0,90,90,0,... exactly.
- Page numbers: "Page N of 5" extracts from every stamped page;
  range 2-3 starting at 5 stamps "Page 5 of 6" / "Page 6 of 6" and
  pages 1, 4, 5 carry no stamp.
- Watermark: the stamp text extracts from every stamped page and
  from the range run's pages 2-3 only; the strength setting moves
  the rendered page measurably (3,238 of 307,200 pixels differ
  between the light and strong runs of the same page).
- Extract: the bench replayed in the browser — ZIP of 3, JPEG entry
  byte-identical, both PNGs pixel-equal, the vector-only page named
  in the report; the weird file yields 4 PNGs and a report naming
  the JPEG 2000 and fax skips with reasons.
- Screenshots: verify/screenshots/m12-watermark-pdf-{desktop,
  mobile}.png and m12-extract-images-pdf-{desktop,mobile}.png,
  read by eye: ledger system, banner, receipt and report all as
  built; mobile stacks clean.

### Defects found and fixed during this milestone (honest list)
- The watermark gate's first two failures were the GATE's, not the
  tool's: pdftotext in layout mode scrambles a rotated stamp into
  position-sorted single letters, and even -raw breaks the line
  mid-stamp. The gate now reads -raw output with whitespace
  squashed (letters stay in stream order); verified against the
  saved outputs before the green run. The stamp itself was correct
  in every run, as the render-diff proved from the first attempt.
- A smoke run early on "failed" because the harness pointed at a
  corpus path that does not exist; the island correctly refused the
  empty file. No page defect.

### Honest leftovers
- Nothing deployed, nothing pushed. Deploy is the parent agent's
  step. Live site remains milestone 11 (54 pages, 13 tools).
- The from/to page inputs in the range rows wrap onto two lines at
  narrow widths (seen in screenshots); usable, matches the shipped
  pattern, not restyled here.
- The four new pages are English only, like the rest of the PDF
  family; ES/PT-BR human review debt is unchanged.
- MILESTONE 12 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist, deployment 6238b7fa.benchzy.pages.dev. Site now 58 pages, 41 tool pages, 17 working tools (rotate, page numbers, watermark, extract images added). IndexNow retried for all 58: result recorded in the deploy report.

## Milestone 13 — the last two PDF tools: organise pages + PDF metadata (2026-11-08, LOCAL ONLY, not deployed)

The PDF family's planned list is finished: the two tools it named
are built, and the /pdf-tools/ hub now declares the family complete
(its planned section is empty; see the discrepancy note at the end).

- /organize-pdf/ — "Remove and organise pages". A picture of every
  page (PDF.js thumbnails rendered in the browser), each tile with
  Earlier / Later / Copy / Remove buttons and drag-to-reorder on the
  same state. At least one page must stay: at one page the Remove
  button disables and the rule is printed under the strip ("At
  least one page has to stay in the document…"), stated before it
  can happen, not after.
- /pdf-metadata/ — "A PDF's stored details". VIEW: title, author,
  subject, keywords, creator, producer, both dates (shown in the
  file's own stored format, D:…, explained on the page), PDF
  version, page count, file size — exactly as stored, "not set" for
  blanks, and a row naming the XMP second copy when a file carries
  one. STRIP/EDIT: set a new title/author (an empty box clears that
  line) or wipe the whole card (info entries + the XMP copy). The
  page's action note and limits carry the required sentence in
  plain words: this changes the file's label card, not its
  contents; wiping the card is not cleaning the document — pages,
  words, pictures, hidden layers and anything written on a page
  stay exactly as they were. No redaction is claimed anywhere.
  Saving never stamps our producer name or the date into the card
  (the engine loads with updateMetadata off, proved by the strip
  gate reading Producer back as unset). A file with nothing to
  wipe gets an honest no-op: no download, a status line saying the
  card is already blank.

### The organise engine, and why (bench first, page second)
verify/m13-bench.mjs compared three engines on fixtures built to
break them (verify/m13-make-fixtures.mjs): two hand-built files
whose font and picture live in a Resources dict on the PAGE TREE
(root node in one, an intermediate node in the other), each with
an outline item pointing at page 3 and known trailer details; a
3-page filled form (text "Ada Lovelace", checkbox checked,
dropdown "Standard"); a 4-page picture+marker file.
- A, copyPages into a new document, and B, delete-extract each
  page then merge the singles: page order and pictures survived
  even on the shared-resource files (this fork's copier resolves
  inherited resources), but both LOST the outline, the stored
  details and the form's field registrations ("no form field with
  the name fullname" on read-back).
- G, the shipped engine (src/scripts/lib/organize-core.js): work
  inside the original document. First write whatever each page
  inherits from its page-tree ancestors (Resources, MediaBox,
  CropBox, Rotate) onto the page itself; copy only the duplicate
  slots (within the same document, after that step); then rewrite
  the root page tree's Kids in the new order and fix the
  document's cached page count/list. G passed EVERY check on all
  four fixtures: order by marker text, pictures reachable through
  the inheritance chain on every page, the outline destination
  resolving to the moved page (index 0 after [3,1,1,4]), stored
  details intact, form values intact (fullname / subscribe /
  plan all read back), and the duplicated form page rendering its
  filled answer ("Ada Lovelace" extracts from the copy too).
What a rebuild does NOT carry, as printed on the page (each line
verified, not assumed):
- A removed page leaves the reading order, but its contents stay
  in the file's storage (its object is never deleted, which is
  what keeps every other reference valid) — so the file may not
  get smaller. The receipt repeats this when a removal happened.
- A bookmark to a REMOVED page stays in the list and leads
  nowhere: the destination object still resolves (the file stays
  valid); it simply is not in the page tree any more (probed
  directly: dest resolves, in-tree index -1).
- A copied form page shows the filled answer, but the field
  itself stays registered once, on the original page.
- Signatures will not verify after the re-save (stated on the
  page, as on the protect page).
Metadata strip/set were benched the same way: strip leaves the
info dictionary with zero keys, every getter undefined, pdfinfo
clean, pages intact; the XMP path has no fixture of its own
(pdf-lib writes no XMP), so it was proved at the primitive level
on a doctored file (catalog /Metadata present before, gone
after, file valid).

### Counts and plumbing
- Working tools 17 -> 19; tool pages 41 -> 43; site pages
  58 -> 60. TOOL_ENGINES extended identically in
  what-free-means.astro, the ES and PT promise pages, and
  verify/seo-audit.mjs; the promise page prints 19 / 43 / 60 and
  the audit's recount agrees. Listings: /pdf-tools/ gains both
  live rows (21 entries) and its planned list is now empty with a
  "The family, complete" section; /tools/ PDF jobs 16 -> 18 rows;
  homepage PDF family gains both rows (liveCount computed);
  llms.txt gains two entries; sitemap auto-grew to 60 locs,
  hreflang unchanged at 48.
- registry-shape OK; SEO AUDIT: ALL CHECKS PASSED (0 warnings),
  both new routes at depth 1, no orphans.

### Verify (full suite, single green pass, VERIFY DONE)
All prior gates reproduced (byte-exact compress-image 199,856 B,
merge 6,674 B within its ±2 container gate, batch 100/100/50/50,
witness 0 requests, weak-crypto mentions 0, protect/unlock round
trips, photo OCR 0.9921, resize dimensions exact, all m12 gates:
rotate values + render swap, page numbers stamped pages only,
watermark render-diff 3,238 px, extract byte/pixel identity with
named skips). Pages loop now covers 60 routes; ZERO console
errors and zero failed requests anywhere in results.json. New
gates (results keys m13*):
- Organise, the task's exact sequence on images-markers.pdf:
  thumbnails all rendered non-blank; delete page 2, move page 3
  to the front, duplicate page 1 -> output markers read
  PAGE-THREE, PAGE-ONE, PAGE-ONE, PAGE-FOUR; a picture is
  reachable on all 4 output pages; the stored title survives;
  PDF.js renders output page 1 at 640x480, non-blank.
- Refuse-empty: deleted down to one page — tiles 1, its Remove
  button disabled, the printed rule visible; the run still builds
  a valid 1-page file (marker PAGE-FOUR).
- Metadata view: the fixture's card shows exactly (title, author,
  subject, keywords "alpha beta gamma", creator, producer, raw
  dates D:20250115103000Z / D:20250620081500Z).
- Metadata strip: output's info dictionary has zero keys, all
  eight getters undefined, pdfinfo shows none of the fixture's
  values, 2 pages intact, and the page's own table re-reads blank.
- Metadata set: title/author read back as set; the subject line
  is untouched.
- Screenshots: verify/screenshots/m13-organize-pdf-{desktop,
  mobile}.png, read by eye: ledger system, bold-orange loaded
  banner, four tiles with real thumbnails in the new order,
  receipt with the removal honesty line; mobile stacks clean.

### Honest leftovers
- Nothing deployed, nothing pushed. Deploy is the parent agent's
  step. Live site remains milestone 12 (58 pages, 17 tools).
- Drag-to-reorder is not gate-covered (the buttons are, and drag
  mutates the same order state); thumbnails render one page at a
  time in order, so a very long document lays out progressively —
  the status line says "Laying out the pages…" until it is done,
  and the arrange buttons work on tiles already laid out.
- DISCREPANCY against the milestone brief, flagged for the
  parent: the brief said the /pdf-tools/ planned list named
  exactly the two tools built here. On disk it named four lines;
  the other two ("JPG to PDF and PDF to JPG" and "Compress PDF
  to 100 KB, 500 KB, 1 MB and 50 KB preset pages") were NOT
  built. Per the brief's instruction the planned list is now
  empty and the hub declares the family complete; those two
  lines were removed from the hub copy, not delivered. Restore
  them as planned lines, or build them, at the parent's word.
- The two new pages are English only, like the rest of the PDF
  family; ES/PT-BR human review debt is unchanged.

## Milestone 14 — the last two planned PDF lines: JPG/PDF conversion + the size preset doors (2026-11-08, LOCAL ONLY, not deployed)

The milestone-13 discrepancy is closed by building, not by copy:
the two lines it removed from the /pdf-tools/ planned list ("JPG to
PDF and PDF to JPG" and "Compress PDF to 100 KB, 500 KB, 1 MB and
50 KB preset pages") are now shipped work. The hub's planned list
is empty because there is nothing left on it; its "The family,
complete" section now stands on built tools. /tools/ also lost its
last planned row ("Convert to and from PDF", live: false) — no
live:false rows remain in tools.astro or index.astro.

- /jpg-to-pdf/ — NEW TOOL. Several pictures (JPG/PNG/WebP) on a
  list with Up/Down/Remove (merge's list pattern), one picture per
  page, page order = list order. Page fit, visitor's pick: each
  page sized to its picture, or pictures fitted centred onto A4 or
  Letter with a half-inch border. JPEG and PNG files are embedded
  by @cantoo/pdf-lib exactly as stored (no recompression); a WebP
  picture is decoded through the shipped image stack and rebuilt
  as a PNG inside the PDF (a PDF cannot hold WebP; the rebuild is
  lossless and the result line says when it happened). Files that
  are not JPG/PNG/WebP are named on the list and left out. The
  finished file is re-opened and its pages counted before the
  download is offered.
- /pdf-to-jpg/ — NEW TOOL. Every page drawn by the shipped PDF.js
  at the visitor's pick: JPG (quality 92, stated on the page) or
  PNG (exact), at screen size (96 DPI) or print size (200 DPI),
  over a white ground. One page returns as the picture itself;
  several return as one ZIP with the pictures named in page order.
  The words-become-picture warning is in the intro, the action
  note, the FAQ and the result line. Locked files are refused at
  the tray with the /unlock-pdf/ pointer. Honest limits carry the
  tested number: a 50-page document rendered page by page at
  screen size (the gate below; 1,554 ms on the test desktop), and
  the memory warning for hundreds of pages at print size.
- FOUR PRESET DOORS on the shipped compress island (pages, not
  tools), each with the target locked the way the 200 KB door
  locks it (data-preset-kb + data-lock-target, so the visitor's
  saved general preset never overrides and none is saved back):
  /compress-pdf-to-50kb/ (visa and passport portals, the tightest
  door in common use), /compress-pdf-to-100kb/ (government form
  portals and application systems), /compress-pdf-to-500kb/
  (email and job boards), /compress-pdf-to-1mb/ (inboxes, contact
  forms, content systems; data-preset-kb 1024). Each is written
  for its own use, and each carries the ladder honesty: if the
  engine cannot reach the size, the island's result line states
  the smallest size it could reach, in the 200 KB door's wording.
  One island change serves the set: the target label reads "1 MB"
  rather than "1024 KB" in the spec row and the result lines
  (compress-pdf.js targetLabel); all other targets print as
  before, and no prior gate's wording moved.

### Counts and plumbing
- Working tools 19 -> 21; tool pages 43 -> 49; site pages
  60 -> 66. TOOL_ENGINES extended identically ('jpg-to-pdf',
  'pdf-to-jpg') in what-free-means.astro, the ES and PT promise
  pages, and verify/seo-audit.mjs; the promise page prints
  21 / 49 / 66 and the audit's recount agrees. Listings:
  /pdf-tools/ gains six live rows (21 -> 27: the four doors after
  the 200 KB row, the two converters after metadata); /tools/ PDF
  jobs gains the four doors and trades its planned convert row
  for the two live converters (18 -> 23 entries); homepage PDF
  family gains six rows; llms.txt gains six entries; sitemap
  auto-grew to 66 locs, hreflang unchanged at 48.
- registry-shape OK; SEO AUDIT: ALL CHECKS PASSED (0 warnings),
  all six new routes at depth 1, no orphans.

### Verify (full suite, single green pass, VERIFY DONE)
All prior gates reproduced (byte-exact compress-image 199,856 B,
merge 6,674 B within its ±2 container gate, batch 100/100/50/50,
witness 0 requests, weak-crypto mentions 0, protect/unlock round
trips, photo OCR 0.9921, resize dimensions exact, all m12 gates,
all m13 gates). Pages loop now covers 66 routes; ZERO console
errors and ZERO failed requests anywhere in results.json. New
gates (results keys m14*; fixtures verify/fixtures/m14, made by
verify/m14-make-fixtures.mjs; the same gate code was iterated
standalone first in verify/m14-probe.mjs):
- JPG to PDF: three fixture pictures (red 300x200 JPG, green
  200x300 PNG, blue 400x400 WebP) reordered on the list to
  blue/red/green; the built PDF's order is proved three ways —
  page sizes [[400,400],[300,200],[200,300]], the stored
  pictures' own dimensions through the m12 extract path (same
  triples), and their centre pixels (blue/red/green within
  tolerance) — and the red page's stored JPEG is BYTE-IDENTICAL
  to the fixture file that went in. A4 run: one picture, page
  exactly 595.28 x 841.89.
- PDF to JPG, print: the 5-page marker fixture -> ZIP of 5 JPGs,
  each exactly 1700 x 2200 (Letter at 200 DPI), each page's colour
  band matching its fixture colour (tolerance 16) and its marker
  text present as dark pixels (counts 1,676–2,067 per page).
  Screen: ZIP of 5 PNGs, each exactly 816 x 1056, bands exact
  (tolerance 6). Single page: the download is the PNG itself
  (pages1-page-1.png, 816 x 1056), not a ZIP. Stress: the 50-page
  fixture at screen size rendered in 1,554 ms, ZIP entries == 50
  == the tested number the page copy prints.
- 50 KB door: the standard corpus photo PDF (11.65 MB) LANDED at
  25,696 B (25.1 KB), under the 50 KB target, at 25% photo size,
  quality 38 — the result line in the ladder's own wording
  ("under your 50 KB target"), the same behaviour the 200 KB
  door's gate asserts.
- Screenshots: verify/screenshots/m14-pdf-to-jpg-{desktop,
  mobile}.png and m14-jpg-to-pdf-{desktop,mobile}.png, read by
  eye: ledger system, bold-orange loaded banner, ordered list
  with real pixel sizes, receipts with the words-are-pictures
  line; mobile stacks clean.

### Defects found and fixed during this milestone (honest list)
- The pdf-to-jpg island's first draft destroyed the PDF.js
  document via pdf.destroy(), which PDF.js 6 removed from the
  document proxy (the milestone-2 lesson, relearned): the run
  died after rendering and no result was offered. Fixed to the
  OCR island's pattern (pdf.loadingTask.destroy(), guarded).
- The first screen-size gate run rendered at print size: the
  island keeps the visitor's last settings (the shipped
  preset-persistence behaviour), and the earlier gate in the same
  browser run had picked 200 DPI. Not a page defect — the gate
  now sets both radios explicitly on every pdf-to-jpg run.

### Honest leftovers
- Nothing deployed, nothing pushed. Deploy is the parent agent's
  step. Live site remains milestone 12 (58 pages, 17 tools); this
  tree is milestone 14 (66 pages, 21 tools) with milestone 13
  (60 pages, 19 tools) undeployed beneath it.
- JPG to PDF places pictures exactly as stored: a phone photo
  whose upright orientation lives only in its EXIF rotation note
  comes out as stored (the embedded bytes are untouched, which is
  the tool's promise); no EXIF-aware rotation is claimed or done.
- The new pages are English only, like the rest of the PDF
  family; ES/PT-BR human review debt is unchanged.
- MILESTONES 13+14 DEPLOYED TOGETHER (2026-11-08): Wrangler Direct Upload from inside dist, deployment f15ce377.benchzy.pages.dev. Site now 66 pages, 49 tool pages, 21 working tools (organise pages, PDF metadata, JPG to PDF, PDF to JPG + four compress preset doors). The PDF family is now genuinely complete: no planned rows remain on /pdf-tools/, /tools/ or the homepage. Milestone 13 was held back one step so this claim was true when it went live. IndexNow retried for all 66: 403 again (0 accepted).

## Milestone 15 — HEIC (built 2026-11-08/09, NOT deployed)

### Audit first (~/workspace/file-toolkit/HEIC-AUDIT.md)
- Verdict: **BUILDABLE WITH CONDITIONS** (all six conditions are build
  steps and all six shipped). Copyright side: libheif + libde265 are
  LGPL-3.0; the compliance checklist (unmodified separate files,
  credits notice with holders, licence texts on the site, source
  links for the exact build, replaceability) is shipped below.
  Patent side: Access Advance's own published software initiative
  (22 Nov 2016) declines royalties for application-layer software
  downloaded after a device's sale that decodes HEVC fully in
  software on a general-purpose CPU, browsers expressly included —
  exactly this site's shape; the former Via LA pool published a
  100,000-units-a-year royalty-free tier. The residual (non-pool
  holders, the policy's unread fine print) is written into the audit
  and goes on the lawyer list as a NOTED item with the exact
  question, not as a gate. A scale tripwire (~100k decoder downloads
  a year) re-opens it.
- First check honoured: no already-shipped dependency decodes HEIC
  (image-core ships jpeg/png/webp only; jSquash has no HEIF codec;
  the createImageBitmap fallback is Safari's OS codec, not ours).
- The pin: libheif-js 1.23.5, wasm variant only. libheif.js
  91,255 B (SHA-256 376c0bb4…) and libheif.wasm 1,463,506 B
  (SHA-256 184d3d20…; gzip 483,656 B) copied byte-identical from the
  npm distribution into public/heif/, hash-checked at vendoring;
  heif_get_version() inside the wasm returns "1.23.5". The decoder
  loads only when a HEIC file arrives (~1.6 MB total).

### What shipped
- **/heic-to-jpg/** (new tool, scripts/heic-to-jpg.js): HEIC/HEIF in,
  JPG (default) / PNG / WebP out on the shipped jSquash writers;
  quality control; the JPG transparency rule with the visitor's
  background colour, stated before the run; wrong-format files
  pointed at batch convert. Copy carries the audit's honesty rules:
  the brightness-range truth in the lede-adjacent "What changes", the
  FAQ and Honest limits; the Live Photo line (still converts; the
  result line says when a file also holds a video, via the decoder's
  sequence flag); the 10-bit line printed on the result when the
  source is 10-bit (luma bits read from the file).
- **src/scripts/lib/heif-core.js**: brand sniffing (ftyp brands incl.
  compatible-brands scan), EXIF orientation parsing, pixel remaps,
  and the decoder driven through libheif's low-level API (the
  packaged display() walks stored planes with display dimensions
  and scrambles turned files). Plugged into the shared image core
  (decodeImageFile), so **resize-image, batch compress / batch
  convert / batch resize and the workflow image steps accept HEIC**
  through it; **compress-image** (both doors) got the same plug in
  its own decoder; **photo OCR** got an explicit third fallback
  (HEIC decoded to a canvas, rasterized to PNG before the reader).
  The six single convert doors still start from their named format
  by design (HEIC has its own door). Remove-background keeps its own
  decode path and its "not accepted yet" note, which stays true.
  jpg-to-pdf does not claim HEIC.
- **Orientation (this milestone's hardest fact, probe-proven):** the
  pinned decoder applies the CONTAINER's transformation properties
  (irot/imir) itself during decode, and does NOT apply the EXIF
  orientation tag. First implementation applied both and the gates
  caught the double turn. Shipped rule: container properties =
  detect and report only; EXIF = applied by us when the file has no
  container properties. All seven EXIF orientations, a quarter turn,
  a half turn and a mirror are fixture-proven upright (below).
  Observed quirk, delegated and disclosed in the audit: with axis
  value 0 the pinned libheif flips top-to-bottom when applying an
  imir property; we let the decoder own container transforms, so
  its reading is what every libheif-based viewer shows.
- **LGPL compliance shipped (audit condition 2):** /credits/ gains a
  HEIC entry plus a dedicated section (libheif + libde265 named with
  struktur AG / Dirk Farin and contributors, LGPL-3.0, unmodified +
  separate-file + replaceability explained, source links for
  libheif-js 1.23.5 and both upstream repos with the pinned version
  printed); the LGPL text serves verbatim at /heif/LICENSE and the
  GPL-3.0 text it incorporates at /heif/GPL-3.0.txt; sw.js caches
  /heif/ cache-first like the other engine dirs.
- **Notes and plumbing:** the "not accepted yet" tray note became
  "JPG, PNG, WebP and iPhone HEIC photos work here." on the seven
  doors that gained HEIC; accept lists extended on compress-image,
  compress-image-to-50kb, resize-image, ocr-image (batch doors were
  already image/*). TOOL_ENGINES gains 'heic-to-jpg' in all four
  places; rows added on /image-tools/, /tools/, the homepage and
  llms.txt. **Counts: 67 pages, 50 tool pages, 22 working tools.**
- **Loader defect found by the gates and fixed:** through a classic
  script tag the glue's own wasm fetch falls back to a synchronous
  fetch that fails in the page ("sync fetching of the wasm failed");
  the loader now fetches /heif/libheif.wasm and passes the bytes as
  the factory's wasmBinary (the package's own documented preload,
  the same thing its Node entry does). Both library files stay
  byte-identical and served from their own URLs.

### Fixtures (verify/fixtures/m15/, maker verify/m15-make-fixtures.py)
Made with pillow-heif 1.8.1 (bundles libheif/libde265/x265; the
system heif-enc has no HEVC encoder). Pattern (400x300, known
corners + centre), orient-2..8 (stored/tag pairs self-checked in
the maker against Pillow's correction table with byte-level tag
reads), tenbit (Main-10, heif-info confirms bit depth 10), photo
(the corpus photo at 1200x900 with measured centre means), text
(OCR line). rotated-irot / rotated-irot180 / mirrored-imir were
made by direct box surgery on pattern.heic (no encoder writes
transformation properties; ipco/ipma rebuilt, iloc base_offset
shifted, heif-info -d validated). All provenance is in
fixtures.json.

### Verify
- **verify/m15-unit.mjs: ALL CHECKS PASSED** — the production
  heif-core run in Node: sniffing, pattern pixel-exact, all seven
  EXIF orientations upright, irot quarter/half turns and the imir
  mirror applied by the decoder exactly once, 10-bit gradient
  correct with lumaBits 10 reported, photo centre mean exact.
- **SEO audit: ALL CHECKS PASSED** (67 sitemap locs, 50 tool pages
  with HowTo, /heic-to-jpg/ depth 1).
- **Browser gates (verify.mjs section 11): ALL PASSED** — photo
  converts to a real JPEG (magic bytes, 1200x900, centre mean
  164,34,126 vs the maker's 164,34,128, wasm served from /heif/);
  EXIF-6 output upright with pattern corners; 10-bit converts with
  the range line printed; resize door exact 600x450; batch convert
  ZIP == 1 (photo.webp); compress door decodes (spec shows
  1200 x 900); OCR door reads the HEIC text fixture at accuracy
  1.0000. Screenshots verify/screenshots/m15-heic-to-jpg-{desktop,
  mobile}.png, read by eye: ledger system, bold-orange loaded
  banner, receipt with stamp, mobile stacks clean.
- **Prior gates:** the full suite's sections 1-7 and the m12
  rotate/page-number gates passed in the milestone's first full
  run (67 pages zero console errors, witness 0 requests,
  compress-image byte-exact 199,856 B, merge 6,674 B, batch
  100/100 and 50/50, m9 protect/unlock round trips, m10 OCR
  0.9901 + ES/PT 1.0, m11 doors + flatten pixel-exact); the
  m12 extract, m13 and m14 gates passed in scoped re-runs. The
  m12 watermark gate needed a correction to an early reading of
  this record: it is extremely slow in the current environment
  (its in-browser render-diff step took about four minutes on a
  box with under 200 MB free memory, which looked like a hang in
  three attempts), but run alone to completion it PASSED with the
  milestone-12 numbers reproduced exactly (words on all pages,
  strength render-diff 3,238 of 307,200 pixels, range only). With
  that, every prior gate stands re-verified for this milestone.
  The scoped runners were temporary section extractions of
  verify.mjs, deleted after use; the gates themselves live in
  verify.mjs section 11.

### Honest leftovers
- Nothing deployed, nothing pushed. Live site remains milestones
  13+14 (66 pages, 21 tools); this tree is 67 pages, 22 tools.
- The decoder pin is a security chore, not a set-and-forget:
  upstream fixed 89 advisories in 2026 (single maintainer); bump
  deliberately and re-run m15-unit + section 11 when it moves.
- iPhone gain-map HDR: the JPG/PNG/WebP copy is the standard-range
  rendition, stated on the page; no output format here carries the
  extra range.
- ES/PT-BR human review debt unchanged; the HEIC pages are English
  only, like the rest of the image family.
- MILESTONE 15 DEPLOYED (2026-11-08): Wrangler Direct Upload from inside dist, deployment da587ea3.benchzy.pages.dev. Site now 67 pages, 50 tool pages, 22 working tools (HEIC to JPG added; HEIC accepted on seven image doors). Licence compliance files verified live under /heif/. IndexNow retried for all 67: 403 again (0 accepted).

## Milestone 16 — Workflows: background removal + OCR as chain steps (built 2026-11-09, NOT deployed)

### What shipped
- **Remove background is a chain step** on /workflows/ (image lane, step 1 or
  mid-chain). It reuses the shipped engine exactly: `loadBgSession` with the
  same model chunks, the same loading lines (44 MB, privacy wording verbatim),
  and a working Cancel button (#wf-cancel, same AbortController pattern as
  the batch page; a stopped load keeps finished outputs and says so). Output
  is the full-size cutout PNG, named `<base>-no-background.png`. A file with
  no subject passes through with a log line, like the standalone pages.
- **Read words (OCR) is a chain step** and always the last step: it ends the
  chain with text. Image input: decoded (HEIC included), flattened onto
  white if it has see-through parts (log says so), scaled by the shared
  plan, read by the shared worker. PDF input: behaves like the OCR PDF
  tool (300 DPI renders, per-page markers past page 1, same 50-page printed
  limit, refusal logged and the file passed through). Text lands in the
  chain receipt as one editable box per file with Copy and .txt buttons;
  the ZIP (when shown) is built on click from the boxes' current text, so
  corrections ride along. The receipt carries the decimal-point warning
  whenever a text output exists.
- **Shared OCR core extracted** to src/scripts/lib/ocr-core.js (plan rule
  + worker manager); the standalone photo OCR page now runs on it with its
  exact original status strings, re-verified by the m10/m15 gates below.
  ocr-pdf.js untouched.
- **Alpha-aware chain compress:** the old chain compress JPEG-encoded
  everything, which would have painted a cutout's removed background back
  in. New rule: an image with see-through parts stays PNG and is fitted to
  the target by a dimension search (new `compressPngToTarget` in
  image-core: largest size under target wins; if even the smallest
  searched size is over, the log says so and hands back that smallest).
  Opaque images keep the measured JPEG path byte-identical; an
  already-under-target JPEG or PNG passes through unchanged.
- **Honest picker:** steps now carry a lane (pdf / image / either). Once
  a chain has a photo step, the PDF steps are disabled in the picker (and
  the other way round), with a note under the builder saying why in plain
  words; OCR fits either lane, and once OCR is in a chain nothing more
  can be added. Moving OCR off last place with Up/Down prints a warning
  row in the steps list and disables Run until it is last again. The
  add-step handler enforces the same rules as the disabled options.
- **Seller cutouts starter:** one click (Remove the background → Compress
  image to 50 KB), on the workflows page, in STARTER_CHAINS, and as a
  card on /presets/. The milestone-8 sentence "background removal and OCR
  are not chain steps yet" is gone (zero occurrences in src/ and public/);
  the Honest limits section now states what is actually true, including:
  chain OCR reads English only (single pages also read Spanish and
  Portuguese), it hands back text and does not make the searchable PDF,
  and a shrunk cutout's dimensions shrink because PNG has no quality dial.
  llms.txt updated to match.
- **Defect found and fixed (pre-existing, since milestone 6):** the
  workflows section and its step <select> shared the id "wf-tool", so
  getElementById returned the section: the select was never populated by
  script and "Add the step" added the default step whatever was picked.
  The starter-button path the gates used never touched the select, so no
  gate caught it. The section is now id="wf-panel"; the picker is gated
  end to end in section 12 below.

### Counts
- Unchanged: 67 pages, 50 tool pages, 22 working tools. Workflows was
  already a tool page; two of its steps grew up, no tool or page added.

### Verify (full suite, one run, VERIFY DONE, ~29.5 min on this box)
- Sections 1–11 all green again: 67 routes, zero console errors and zero
  failed requests on every route; witness 0 requests; compress image
  byte-exact 199,856 B; batch 100/100 and 50/50; protect/unlock; OCR
  standalone (incl. ES/PT); resize/flatten pixel-exact; m12 watermark
  render-diff 3,238 of 307,200 px reproduced; m13, m14 (preset-50k
  25,696 B), m15 (all HEIC doors, OCR door accuracy 1.0000).
- Section 12 (new): **picker gate** — image lane disables the four PDF
  steps with the "works on photos" note; PDF lane disables both photo
  steps; OCR in a chain disables every option with the ends-with-text
  note; OCR moved off last disables Run and shows the warning.
  **OCR chain gate** — m10 big fixture returns accuracy **0.9921**,
  identical to the standalone page, decimal-point note shown; the
  scanned-PDF fixture returns text containing INVOICE and 2026-TEST-0042.
  **Seller chain gate** — remove-bg alone: PNG 936,993 B at 1200x900,
  all four sampled corners alpha 0, 57.8% transparent / 23.6% opaque;
  then the one-click starter from the same single file pick: **PNG
  50,841 B** (target 50 KB = 51,200 B), 185x139, corners alpha 0,
  57.4% transparent: transparency survives the fitted PNG. Run log:
  cut out at full size 1200x900 in ~12 s → 915 KB; "has see-through
  parts, so it stays a PNG: 915 KB to 49.6 KB at 185x139."
- Screenshots: verify/screenshots/m16-workflows-{desktop,mobile}.png,
  read by eye: ledger system, seller result receipt with Done stamp,
  picker note, five starters, new FAQs; mobile stacks clean.

### Honest leftovers
- Nothing deployed, nothing pushed. Live site remains milestone 15
  (67 pages, 22 tools); this tree is the same counts with the chain
  steps built in.
- Chain OCR is English-only by design this milestone; the language
  picker lives on the single pages. Chain OCR does not produce the
  searchable PDF (stated on the page).
- The 185x139 seller result is small because a photographic cutout as
  PNG is heavy at 50 KB; the log prints the dimensions it landed at,
  and a bigger target (the compress step's number is editable before
  saving) lands a bigger picture. No silent quality promise is made.
- The chain Cancel covers the model download (the long wait), wired
  exactly like the gated batch page; inference itself is not
  interruptible, same as the standalone pages.
- MILESTONE 16 DEPLOYED (2026-11-09): Wrangler Direct Upload from inside dist, deployment 98c01494.benchzy.pages.dev. Counts unchanged (67 pages, 22 tools): background removal + OCR are now chain steps on /workflows/, incl. the one-click seller starter (cut out -> compress to 50 KB). Note: the builder's completion report was lost to a runtime restart; the milestone was recovered from this file and the tree, re-verified live (67/67 URLs 200, workflows chain copy confirmed). IndexNow retried for all 67: 403 again (0 accepted).

## Milestone 17 — the flagship quality-proof page (built 2026-11-09, LOCAL ONLY, not deployed, not pushed)

### What shipped
- NEW content page /remove-background/quality/ (src/pages/remove-background/quality.astro):
  the round-1 user-test flagship gap closed. Six hard photos run through the
  SHIPPED /remove-background/ tool itself, each shown three ways: the original
  photo, the cutout composited over a 20 px checkerboard, and a 100% crop
  (native pixels, 360x360, no rescaling) of the hardest edge. Per case: a
  plain-words verdict, what held, what did not, a download link to the raw
  cutout PNG the tool produced, and the photo credit with its licence.
- Linked from /remove-background/ (intro + Honest limits), /vs-remove-bg/
  ("What this page does not claim" now points at the proof page while still
  stating we have never run a head-to-head quality test against remove.bg),
  /background-removal/ hub (same revision), and llms.txt.

### How the gallery was made (nothing hand-made)
- verify/m17-make-gallery.mjs drove the real tool page in headless Chrome:
  each source ran twice in one session; the first run warms the program, the
  second is the recorded one. 16 runs (6 cases + 2 ladder sizes), zero console
  errors, no no-subject failures, repeat runs byte-identical.
- verify/m17-finish-gallery.py composited the grounds and cut the crops.
  Files live in public/proof/ as <case>-original/-cutout/-ground/-crop.
  The displayed original is byte-identical to the gallery source; the
  displayed cutout is byte-identical to the tool's own download blob.
- Provenance: verify/m17-sources/PROVENANCE.md. White egg: Ren West,
  CC BY 2.0 (Commons). Hair + glass: Shixart1985, CC BY 2.0 (Commons).
  Busy market portrait: Wilfredor, CC0 (Commons). Chrome motorcycle engine:
  rawpixel, CC0 (rawpixel's own 1024px web version). Strands: the project's
  own drawn bench picture (test-bg-hard.png), labelled synthetic on the page.

### The six cases, honestly
- white (1024x683, 0.70 MP, warm cut 10.6 s) — HELD. Shell edge followed
  cleanly; flaw named on the page: a faint half-clear speck spray just left
  of the egg.
- hair (1280x1918, 2.46 MP, 9.7 s) — HELD. Single curls and flyaway strands
  followed; flaws named: a strip of her chair came along at the bottom edge,
  and the loosest strands keep a hint of the warm wall behind them.
- busy (1920x1290, 2.48 MP, 9.7 s) — HELD, with a judgement call printed on
  the page: market clutter gone and the hairline clean, but the woman in red
  behind her was kept too (the tool removes backgrounds; it does not choose
  between people), and a sliver of bananas at the left edge came along.
- glass (1920x1282, 2.46 MP, 10.2 s) — MIXED, shown as a struggle case.
  Laptop gone, rim and water surface solid, but the clear walls fade to half
  strength below the rim and a piece of the table under the glass came along
  at half strength.
- chrome (1024x695, 0.71 MP, 9.9 s) — THE LIMIT CASE, shown unedited. Dark
  parts and the exhaust pipe are solid, but much of the bright chrome came
  out half see-through (the checkerboard shows through the engine):
  reflections that mirror the background read as background.
- strands (1200x900, 1.08 MP, 9.8 s) — HELD. The drawn strand fan survives,
  thinning toward its edges (the bench gate picture: strands 95.9%).
- Page intro states the split up front: four held, two struggled, named.

### Speed wording and its bench basis
- The page prints seconds per photo, NOT a per-megapixel number, because the
  bench does not support one: on the same busy photo, warm cut times were
  0.70 MP -> 9.8 s, 2.48 MP -> 9.7 s, 5.57 MP -> 10.3 s. Across 0.70-5.57 MP
  the six cases landed 9.7-10.6 s warm. The time is dominated by the program,
  not the pixels, at these sizes.
- Machine sentence printed on the page: timings measured on our test
  computer, a desktop-class machine with four processor cores, in Chrome,
  with the removal program already downloaded; a visitor's own device will
  differ. First photo of a session: program start 2.6 s, first cut 11.6 s.
- No phone time is printed anywhere on the page: we have never measured one.
  (Consistent with NUMBERS.md: the ~12.9 s warm figure there is the same
  bench class; the gallery runs are the fresher, per-case numbers.)

### Counts
- 68 pages, 50 tool pages, 22 working tools. The proof page is a content
  page, not a tool; sitemap and promise-page counts pick it up automatically.

### Verify
- npm run build clean (68 pages). verify/seo-audit.mjs ALL CHECKS PASSED,
  0 warnings (sitemap 68 locs, quality page at depth 2, no orphans).
- verify/m17-check.py (independent Python re-derivation): displayed
  originals byte-identical to sources, displayed cutouts byte-identical to
  the tool-produced blobs, cutout dimensions equal source dimensions,
  grounds pixel-exact composites over the checkerboard, each crop
  pixel-identical to its recorded box in the ground image. ALL PASSED.
- Full verify/verify.mjs suite: VERIFY DONE, one run, all prior gates green
  (sections 1-12 reproduced, incl. m12 watermark render-diff 3,238 of
  307,200 px and the m16 seller chain at PNG 50,841 B). New section 13:
  M17 CHECK ALL PASSED + the proof page loads with 18 /proof/ images, zero
  console errors, zero failed requests. Run log: verify/m17-verify-run.log.
- Screenshots: verify/screenshots/m17-quality-{desktop,mobile}.png.

### Honest leftovers
- Nothing deployed, nothing pushed. Live site remains milestone 16
  (67 pages, 22 tools); this tree is 68 pages with the proof page local.
- Chrome and glass are admitted on the page as the two cases where the
  engine still struggles; no gallery case was dropped or re-shot to hide
  a failure. Every case ran once warm and was published as it landed.
- The busy case keeps the second person by design of the tool class, and
  the page says so rather than calling it a clean win.
- MILESTONE 17 DEPLOYED (2026-11-09): Wrangler Direct Upload from inside dist, deployment a56113ca.benchzy.pages.dev. Site now 68 pages, 22 working tools; /remove-background/quality/ is live (six hard cases run through the shipped tool; four held, glass mixed, chrome shown unedited as the limit case; speed printed as ~10 s warm on the named desktop class with no per-megapixel figure, because the bench refuted one). IndexNow retried for all 68: 403 again (0 accepted).

## Milestone 18 — the round-2 fix round (built 2026-11-09, LOCAL ONLY, not deployed, not pushed)

Work list: round-2 user-test summary (~/workspace/file-toolkit/user-tests/
round-2-2026-11-09/ROUND-2-SUMMARY.md), letters A–J. Every letter done;
the two done-differently notes and two scope notes are marked inline.

### A. HEIC in the background remover (Broken 1) — DONE
- New shared helper in src/scripts/lib/bg-engine.js: bitmapFromPhotoFile
  sniffs the file's bytes (lib/heif-core isHeifFile); HEIC goes through
  the shipped libheif decoder, and the preview URL is a PNG of the
  decoded picture (an object URL of a HEIC file does not render in
  Chrome). Wired into src/scripts/remove-bg.js (single + homepage hero;
  the before/after compare uses the decoded preview too; the spec's
  format row reads HEIC), src/scripts/batch-remove-bg.js, and the
  workflows chain step (workflows.js decodeChainBitmap now checks
  HEIC FIRST instead of relying on createImageBitmap to fail).
- Copy: traySub + heicNote in all three locales of src/locales/bg.js
  now say HEIC works; the batch page's tray line says the same. No door
  needed the /heic-to-jpg/ refusal fallback; all three doors take HEIC.
- Gate (verify section 14): new fixtures verify/fixtures/m18/
  (bg-twin.heic + bg-twin.jpg, the corpus bench picture encoded both
  ways by verify/m18-make-fixtures.py, pillow-heif 1.8.1). HEIC cutout
  1200x900, corners all 0, transparent fraction 0.547 vs the JPG twin's
  0.565 (band 0.06), opaque 0.236 vs 0.232: same alpha profile class.
  Batch: fixture listed at 1200 x 900, cut out at full size. Chain:
  cutout byte-size identical to the single tool's (1,297,218 B).

### B. One speed number (Broken 2) — DONE
- Every "about 13 seconds" flagship claim replaced with the proof
  page's measured wording (9.7–10.6 s warm, desktop-class test
  computer, program downloaded, first photo of a session slower,
  phones unmeasured): remove-background FAQ, full-resolution FAQ,
  vs-remove-bg table + body, alternatives intro, batch page, and the
  ES (x2) and PT pages in their own decimal-comma forms.
- Gate: "13 seconds / 13 segundos / about 13 / unos 13 / cerca de 13"
  greps to ZERO in src/.

### C. OCR fixes flow into the searchable PDF (Broken 3) — DONE, the full outcome shipped
- Faithful re-placement proved possible with the shipped stack, so it
  was implemented rather than falling back to warning placement:
  src/scripts/ocr-pdf.js splits the box text back into pages on the
  --- Page N --- lines, aligns each page's corrected tokens to the
  recogniser's words by an LCS walk over normalised tokens, and draws
  the corrected tokens at the replaced words' boxes (insertions after
  the preceding word, deletions drawn nowhere). If the page markers
  were edited away, the PDF falls back to the as-read layer and the
  status line says so plainly, with the remedy.
- Copy updated: FAQ "What do I get at the end?", HowTo step 4, the
  post-read line (both downloads now use the corrected text), and the
  post-download status (three honest variants: corrected / unchanged /
  fallback).
- Gate, end to end: OCR the corpus invoice, fix 12450 -> 124.50 in
  the box, download the searchable PDF, extract its text layer with
  PDF.js: carries "124.50", does not carry "12450", status reads
  "carries your corrected text".

### D. The false sentence (Broken 4) — DONE, wider than the letter
- "There is no server here that could receive them" removed from
  /what-free-means/ and its ES/PT versions, AND from the two other
  places the same claim lived: the site footer (Base.astro footHow,
  all three locales, i.e. every page) and the homepage FAQ. The true
  sentence everywhere: files never reach a server; the site's pages
  are served by a host, Cloudflare Pages, named on the privacy page.
- Left standing, deliberately: remove-bg-api.astro ("no server that
  receives files" — true in its API context) and sign-pdf.astro ("no
  server in the job" — about the signing job, not the site's serving).

### E. Warnings at the moment of action (Unclear 14) — DONE
- Compress family (main /compress-pdf/ + the five preset doors):
  "this file may not reach the target" now sits directly under the
  tray (before picking) and opens the action-note directly above the
  run button. Scope note: the image set-size door was not given the
  line; its engine lands by shrinking dimensions and its failure mode
  is not the one round 2 named (the quote was the PDF 50 KB door).
- /ocr-image/: the decimal-point warning (124.50 read as 12450) is now
  an action-note directly under the tray, before picking.
- /flatten-pdf/: the action-note above the Flatten button now carries
  the one-way sentence (fields cannot be edited as fields again; keep
  the editable original) ahead of the signature warning.
- /heic-to-jpg/: the Live Photo line (still picture only; the result
  line says when one is picked) now sits at the tray.

### F. Set-size doors finished (Missing 5) — DONE
- The standard corpus photo PDF (photo-1page.pdf, 11.65 MB) run
  through the shipped doors in the harness: 100 KB door landed at
  90,117 bytes (printed: 88 KB); 50 KB door landed at 25,696 bytes
  (printed: 25.1 KB). Both printed in the FAQ and in How it works,
  the same places the 500 KB door prints its 415 KB. (The 50 KB
  landing is well under the line: the known ladder over-shrink,
  printed as measured, not rounded up toward the target.)
- Onward pointers on every set-size door (the five preset doors and
  the main compress page): strong compress door + split door, at the
  result receipt and in Honest limits.
- Gate: section 14 re-runs both doors and asserts the printed claim
  equals fmtBytes of the harness's own output bytes, and the pointers
  are on the page.

### G. Problem-worded fast lanes (Missing 6) — DONE
- The homepage hero strip is now "I need to…" with four doors: shrink
  a photo for a form -> /compress-image/; my iPhone photo will not
  upload -> /heic-to-jpg/; get files under a visa or portal limit ->
  /compress-pdf-to-50kb/; cut out a product photo ->
  /remove-background/. The strip sits in the hero, so it is above the
  ledger on mobile too; the label now uses the .fl-k class the CSS
  defines. Gate: all four links present with their wording, each
  landing page's H1 names the promised tool. Screenshots:
  verify/screenshots/m18-home-fastlanes-{desktop,mobile}.png.

### H. Spanish seams (Missing 8) — DONE
- True redirects: public/_redirects carries 301 rules
  /es/quitar-fondo/ -> /es/quitar-fondo-de-imagen-gratis/ and
  /pt/remover-fundo/ -> /pt-br/remover-fundo-de-imagem-gratis/ (plus
  the no-trailing-slash forms); the meta-refresh stub directories are
  deleted, since Pages serves an existing file in preference to a
  rule. verify/seo-audit.mjs was updated to assert the new mechanism
  (rules present, stubs absent, short URLs still out of the sitemap);
  its purpose is unchanged and the enforcement is stronger (a real
  HTTP 301, not a refresh). Gate in section 14 asserts the same.
- Language line: Base.astro renders a hidden line at the top of
  <main> on English pages that declare NO es/pt-BR alternate; an
  inline script shows it, in Spanish or Portuguese with a link back
  to the ES/PT trust pages, when the tab session has visited an
  /es/ or /pt-br/ page or the same-origin referrer is one. Pages with
  translations never render it. Fresh visits see nothing, so no gate
  or screenshot is affected. The standing "(en inglés)"/"(em inglês)"
  markers beside English-only tools on the ES/PT trust pages were
  already in place and were verified, not changed.
- Calques: "La descarga es como protegemos tu privacidad" ->
  "Protegemos tu privacidad con la descarga" (and the PT twin, same
  construction, fixed the same way); "Pulsa/pulsas" -> "Presiona/
  presionas" in the two ES background-removal HowTo steps, the ES
  witness steps, and the two ES runtime strings in locales/bg.js.
  "Pulsa" now greps to zero in src/.

### I. Signposts (Unclear 15, 17, 18 + Missing 9, 11) — DONE
- Merge intro: "Pages in the wrong order inside one file already?
  That is not a merge; use Organise PDF."
- Workflows intro and OCR PDF intro: the one-off-scan pointer both
  ways, and "chains end in plain text, no searchable PDF" stated on
  both pages.
- Extract images, Honest limits: a scanned book yields one stored
  picture per page, plus the /pdf-to-jpg/ render-and-crop route.
- Organise "How it works": the shared-shelves workshop paragraph
  replaced with the plain Q&A version modelled on its own FAQ
  ("Are the pages rebuilt? No…"), keeping the verified-against
  sentence and the privacy/download sentences.
- Metadata: the intro ties the label card to the viewer's Properties
  panel by name; the table now shows stored dates as the raw D: form
  with the same date read out beside it ("read as: 15 January 2025,
  10:30:00"), read from the stored digits with no timezone
  conversion; FAQ and How-it-works copy match. Gate: the m13 fixture
  shows both raw forms and both readings (the m13 gate's raw-substring
  assertions still pass).
- Resize: the 1600 preset is named "eBay / Marketplace · long side
  1600" (page copy and HowTo agree); passport values are printed in
  the tray before a photo is picked (413 x 531 px = 35 x 45 mm, US
  600 x 600 px = 2 x 2 in, both at 300 DPI), with the fits-inside
  note in output pixels (a 4:3 photo in the 413 x 531 frame comes
  out 413 x 310 px; the result line always prints exact output
  pixels). Batch resize carries the same eight preset chips, wired
  to fill its width/height boxes.

### J. Small honest completions (Missing 10, 12, 13 + chains) — DONE
- /privacy/: the host is named (Cloudflare Pages) in "What the server
  keeps"; the password promise added ("passwords are used in the page
  only and are gone when the page closes", never stored or logged);
  retention stated only from what we control (we keep no logs of our
  own; the host's connection logs exist on the host's schedule, no
  day count invented).
- Witness pages (EN + ES + PT): retitled so none says "proof" (EN:
  "Check it yourself: watch what a job sends"); a BAD-line example
  added (a POST to another site, marked WITH DATA ATTACHED, with the
  two tells) and the airplane-mode check (open once connected ->
  airplane mode -> run to download -> a never-opened tool still
  needs one connected first visit), in all three languages.
- /protect-pdf/: minimum is now 12 characters, enforced in the run
  handler with the plain reason, stated beside the inputs before
  typing ("length is what protects you"), with the separate-channel
  sharing tip in the action-note and the Honest limits floor updated
  from eight to twelve. The m9 gate's password was lengthened to
  match (gate-pw-987654); a new section-14 gate refuses a
  10-character password and asserts nothing was delivered.
- /workflows/: the OCR starter chain "Receipt words" (photo of a
  receipt -> read the words) added beside the seller starter in
  lib/chains.js, the workflows starter list (now six), the HowTo
  list, and the preset gallery.

### Counts
- 68 pages, 50 tool pages, 22 working tools. Unchanged: this round
  fixed and finished; it added no pages and no tools. One public file
  added (public/_redirects), two stub directories removed.

### Verify
- npm run build clean (68 pages). Full verify/verify.mjs suite:
  VERIFY DONE, exit 0, one run, all prior gates green (byte-exact
  compress/merge, batch numbers, witness 0, protect/unlock with the
  lengthened gate password, OCR standalone + chains, resize, m12–m17
  gates incl. the M17 CHECK) plus new section 14: HEIC remover /
  batch / chain, corrected-text searchable PDF end to end, the two
  printed landings asserted against the harness's own outputs,
  fast-lane doors, true redirects, metadata date readings, protect
  floor. Run log: verify/m18-verify-run.log.
- verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings (after the
  redirect-mechanism update described under H).
- Screenshots: verify/screenshots/m18-home-fastlanes-{desktop,
  mobile}.png, m18-remove-background-heic-{desktop,mobile}.png (the
  desktop one shows bg-twin.heic loaded, format HEIC, preview
  rendered from the decoded picture).

### Honest leftovers
- Nothing deployed, nothing pushed. Live site remains milestone 17
  (68 pages, 22 tools); this tree is milestone 18 local.
- GA4: a Benchzy property now exists (per the owner's order recorded
  2026-11-09) and the tag + the /privacy/ wording naming Google
  Analytics are recorded as shipping with the milestone-18 deploy.
  The tag is NOT installed in this local round: the A–J work list did
  not include it, and installing it without the coordinated copy
  changes would falsify the printed "no analytics script runs today"
  lines on /privacy/ and the witness family table, and would break
  the witness's own-origin request gates. Flagged for the parent to
  schedule as its own step with the deploy.
- The ads answer (round-2 Missing 7) remains out of scope by the
  task's own instruction; full ES/PT tool translation remains owed.

## Milestone 19 — the GA4 tag, with its copy coordination (built 2026-11-09, LOCAL ONLY, not deployed, not pushed)

The step milestone 18 flagged: the GA4 property exists (created
2026-11-09 on the owner's order; Measurement ID G-PSWNWPP7PY), and the
tag ships only together with the copy changes that keep every printed
line true. Page views only; no custom events.

### The tag
- src/layouts/Base.astro: the standard Google tag in <head> on every
  page and locale — async script from
  www.googletagmanager.com/gtag/js?id=G-PSWNWPP7PY plus the inline
  dataLayer / gtag('config', 'G-PSWNWPP7PY') snippet, with a comment
  stating it fires once when a page opens, is not part of any tool,
  and is never told anything about files. Confirmed present in the
  built output of EN, ES and PT pages (2 ID mentions per page: the
  script URL and the config call).

### Copy lines changed, each with its reason
- src/pages/privacy.astro: meta description now says "visits counted
  with Google Analytics, no ad scripts". The sentence "no analytics
  script and no advertising script runs on these pages at all" is
  replaced with "no advertising script runs on these pages. One
  script does count visits; it has its own section next, in the
  open." NEW section "Counting visits, in plain words" before the
  browser-storage section, four paragraphs: visits are counted with
  Google Analytics, a visit counter run by Google, named rather than
  riding along quietly; what it sees (a page opened, which page,
  roughly where the connection comes from, device and browser kind;
  counts kept on Google's systems under its rules); what it never
  sees (files — it fires at page open, is not part of any tool, is
  never told a file's name, size or contents, and a tool run sends it
  nothing), with a link to the check-it-yourself page; how to block it
  (content blocker, browser tracking protection, and the Google
  Analytics opt-out add-on named) with tools working exactly the same
  blocked.
- Witness family (src/pages/check-it-yourself.astro +
  es/compruebalo-tu-mismo.astro + pt-br/confira-voce-mesmo.astro):
  the "Any page on this site" table row now lists the visit counter
  among what a page loads and states its line is the one addressed to
  Google, labelled "visit counter" in the live list; manual step 4
  rewritten to say the lines a visitor sees are the page's own parts
  plus the counter's line from page open; the bad-line explanation
  qualified: healthy lines carry nothing of the visitor's apart from
  the counter's line, which carries the visit. The witness's promise
  is unchanged and still graded: a tool RUN uploads nothing.
- src/scripts/witness.js (all three locale string sets): new
  "visit counter" row label; the before-count, verdict and done lines
  now count counter requests separately and say so in words ("1 is the
  visit counter firing as the page opened"; "Network requests during
  the job: N (the visit counter's own among them: C)"). Header comment
  records the honesty contract: counter requests are listed, labelled
  and bucketed; the graded claim is that a job sends nothing, not that
  a page load is invisible.
- /what-free-means/ EN + ES + PT: the "No daily counters" never-list
  entry gained the sentence that visits to pages are counted with
  Google Analytics (named on the privacy page) so used tools can be
  seen, that jobs are not counted, and that no count can run out or
  lock a tool; meta descriptions corrected from "no counters" to "no
  daily counters" in all three.
- src/pages/index.astro: standing-facts row "daily limit / there is
  no counter" becomes "there is no job counter"; the "No counter, no
  account" point becomes "No job counter, no account" with the
  parenthetical that page visits are counted, named on the privacy
  page, and never touch a job. (credits.astro's "no job counter in
  the code" was already precise and stands; llms.txt carries no
  analytics claim. Grep sweep: no "no analytics" / "ningún script de
  analítica" / "nenhum script de análise" claim remains anywhere in
  src/ or public/ except the new milestone-19 text itself.)
- TRANSLATIONS.md: item 19 registers the ES/PT witness, free-means
  and witness.js string changes as in-house drafts, PENDING HUMAN
  REVIEW like every other item.

### Verify-harness reconciliation (deliberate, recorded; no gate weakened silently)
Environment fact, probed first: this sandbox's headless Chrome cannot
reach Google at all (default launch ERR_TUNNEL_CONNECTION_FAILED on
googletagmanager.com; explicit proxy ERR_NO_SUPPORTED_PROXIES;
--no-proxy-server ERR_SSL_PROTOCOL_ERROR; the shell reaches Google
through the egress proxy, Chrome cannot). So openPage now intercepts
the two Google hosts on every page: every request to them is RECORDED
(host + full URL, asserted by the gates below) and answered with a
stand-in — a minimal gtag.js mirroring the one behaviour this site's
code controls (a 'config' call fires exactly one page_view collect
carrying the ID) and 204/GIF answers for collects. This is a stand-in
for a third-party endpoint the sandbox cannot reach, recorded in the
harness header; it does not soften any assertion, because the gates
assert the recorded requests themselves.
- Pages loop: per-route GA record added; a route fails unless it
  fired exactly one gtag/js request carrying id=G-PSWNWPP7PY and
  exactly one collect with tid=G-PSWNWPP7PY. Any failing route aborts
  the suite after the loop ("GA GATE: tag + one collect with
  G-PSWNWPP7PY on every route in the loop" prints when all pass).
- Witness gate (section 1b) rewritten to the updated form: parses the
  done line's totals, requires (requests during the job − the
  counter's own among them) = 0, zero requests with a body, at least
  2 counter-labelled rows across the before/live lists, and the
  counter named in the before-count text. The old form (a bare
  "during the job: 0" substring) could no longer express the truth
  now that a page counter exists; the new form throws on failure
  where the old one only recorded.
- NEW section 15: (a) homepage gate — exactly one
  googletagmanager.com/gtag/js?id=G-PSWNWPP7PY request and exactly
  one collect to www.google-analytics.com with tid=G-PSWNWPP7PY and
  en=page_view; (b) privacy gate — /privacy/ body must name Google
  Analytics and the opt-out, must not contain the old "no analytics
  script" claims, and is screenshotted
  (verify/screenshots/m19-privacy-desktop.png); (c) background-tool
  gate — a fresh /remove-background/ run of the hard corpus photo
  with the record cleared at the Run click asserts zero requests with
  a body during the run and zero http(s) cross-origin requests to any
  host other than the two counter hosts. During its first green-run
  attempt this gate counted the design's grain texture (a data: SVG,
  origin "null") as cross-origin and failed a clean run; the filter
  is now restricted to http(s) with the reason recorded in the code,
  because data:/blob: URLs are generated inside the page and cannot
  carry a file anywhere. Offending URLs are recorded with the result
  so a future failure explains itself.

### Verify
- npm run build clean (68 pages). verify/seo-audit.mjs: ALL CHECKS
  PASSED, 0 warnings.
- Full verify/verify.mjs suite: VERIFY DONE, zero console errors
  across all 68 routes, every route passing the per-route GA gate;
  witness gate in its new form green (0 during the job, 0 with a
  body, 2 counter rows labelled); section 15 green (GA homepage
  js 1 / collects 1; privacy wording true; BG run sends: 1 request
  in the window, the in-page data: grain texture, 0 with a body,
  0 cross-origin). Run log: verify/m19-verify-run.log. The road
  there, honestly: attempt 1 passed everything through milestone 17
  and then the sandbox's parallel load starved milestone 18's
  HEIC-remover gate past its 900 s wait (the same steps, probed
  standalone with the same interception, finished in 10 s);
  attempt 2 was killed mid-run by a VM restart (uptime reset
  confirmed); attempt 3 reached section 15 and failed only on the
  data:-URL classification fixed above; attempt 4 is the green run.

### Counts and leftovers
- Counts unchanged: 68 pages, 50 tool pages, 22 working tools. The
  tag adds no page and no tool.
- Nothing deployed, nothing pushed. Live site remains milestone 17;
  this tree is milestones 18 + 19 local, ready to deploy together —
  until the tag is live, Benchzy visits are still uncounted.
- MILESTONES 18+19 DEPLOYED TOGETHER (2026-11-09): Wrangler Direct Upload from inside dist, deployment 7fc39f65.benchzy.pages.dev. Counts unchanged (68 pages, 22 tools): the round-2 fix round (HEIC in the remover, OCR corrections into the searchable PDF, warnings at the moment of action, homepage fast lanes) AND the GA4 tag G-PSWNWPP7PY with its privacy/witness copy coordination are live. Live checks: all 68 sitemap URLs 200; GA tag present on EN home, ES home and the remover page; /privacy/ carries the counting section; /es/quitar-fondo/ returns a real redirect. IndexNow retried for all 68: 403 again (0 accepted).

## Milestone 20 — the five-country Spanish review fixes (built 2026-11-09, LOCAL ONLY, not deployed, not pushed)

Input: five SIMULATED native-reviewer reports (personas, not people) in
~/workspace/file-toolkit/language-review-2026-11-09/ — es-mexico.md,
es-spain.md, es-peru.md, es-argentina.md, es-colombia.md — read in full
against TRANSLATIONS.md. Applied: every item flagged by two or more
reviewers, plus unambiguous single-reviewer hard errors. Not applied:
Spain-only localization (ordenador, pulsar, recuento), decimal-point
conversion (decimal commas stay, owner's pan-regional call), any tú-form
change. Portuguese and English untouched. 50 replacement operations,
51 text spots, across 7 files. Source reports in brackets per line
(MX Mexico, ES Spain, PE Peru, AR Argentina, CO Colombia).

### Lines changed
quitar-fondo-de-imagen-gratis.astro (4 operations, 5 spots):
- Speed FAQ sentence rewritten whole: "en pasadas en caliente en
  nuestra computadora de pruebas, de clase escritorio" and "no
  prometemos un tiempo de teléfono" -> Peru's form: "en pruebas
  repetidas, con el programa ya descargado, en nuestra computadora de
  escritorio de pruebas; ... no prometemos cuánto tardará en un
  teléfono, porque no lo hemos medido." [all five]
- "Los 44,3 MB cuentan contra tus datos móviles" -> "se descuentan de
  tu plan de datos" (HowTo step 2 and the lead paragraph). [MX, AR, CO]
- "Protegemos tu privacidad con la descarga. Nuestro programa viene a
  tu dispositivo..." merged to "Así protegemos tu privacidad: el
  programa viene a tu dispositivo..." (the fix sentence was already the
  next sentence; the calque sentence is gone). [MX, PE, AR]
- "un modelo ISNet, de pesos abiertos" -> "con los pesos publicados
  (cualquiera puede revisarlos)" (Colombia's explained form). [MX, PE, CO]

quitar-fondo-resolucion-completa.astro (7):
- Speed FAQ rewritten whole, Peru's form adapted: "Con el programa ya
  descargado, cada recorte tardó ... en pruebas repetidas, en nuestra
  computadora de escritorio de pruebas; ... no promete cuánto tardará
  en un teléfono." [all five]
- "Esos 44,3 MB cuentan contra tus datos móviles" -> "se descuentan de
  tu plan de datos". [MX, AR, CO]
- "ni un plan pago que esconda..." -> "plan de pago" (HowTo step 3 and
  the intro paragraph). [all five]
- "A diferencia de eso," -> "En cambio," and "uso privado" -> "uso
  personal" in the remove.bg-terms FAQ. [MX, CO]
- Meta description "El tamaño que subes es el tamaño que descargas"
  (contradicted the no-upload promise) -> "La foto entra a tamaño
  completo y el recorte sale a tamaño completo." [MX, PE]
- "la foto que pusiste" -> "la foto que elegiste". [PE]

que-significa-gratis-aqui.astro (15):
- "ni un tamaño pago grande" -> "tamaño de pago grande". [all five]
- "las sirve un alojamiento, Cloudflare Pages" -> "un servicio de
  hosting, Cloudflare Pages" (task-settled form; PE/AR verbatim). [MX, PE, AR, CO]
- "ninguna cuenta puede acabarse" -> "ningún conteo puede agotarse".
  [PE]
- Heading "Sin descarga retenida por un pago" -> "Sin descargas
  bloqueadas por un pago" (Spain's heading form, keeps the list's
  "Sin..." shape; the meta description twin changed with it). [ES, CO]
- "una descarga que se convierte en cobro" -> "termina en un cobro".
  [ES, CO]
- "Nada aquí está disfrazado de descarga para actuar como anuncio" ->
  "Ningún botón se disfraza de descarga: lo que parece una descarga es
  una descarga, no un anuncio." [CO]
- "'Gratis' es la palabra más maltratada" -> "la palabra de la que más
  se abusa". [MX]
- "Contado por el propio sistema de publicación desde el sitio..." ->
  "Esta cuenta la hace el propio sistema que publica el sitio, el día
  en que se genera esta página." [CO]
- The correr family: "cada trabajo corre en sus computadoras" -> "se
  ejecuta"; "Las herramientas de Benchzy corren dentro de tu
  navegador" -> "funcionan"; "el trabajo corre en tu computadora" ->
  "el trabajo se hace en tu computadora"; "todavía no corre ningún
  anuncio" -> "todavía no se muestra ningún anuncio" [MX, PE, CO over
  ES's "no hay ningún anuncio"]; "un trabajo no puede correr" -> "no
  puede ejecutarse"; "mientras un trabajo corre" -> "se ejecuta".
  [ES, CO, plus singles]

compruebalo-tu-mismo.astro (16):
- "comprueba contra una lista de huellas publicada" -> "compara con
  una lista de huellas digitales publicada". [AR, CO]
- "En una corrida sana" -> "En una prueba normal" [CO, PE over MX/AR
  "pasada normal" and ES "ejecución normal"].
- "el trabajo con testigo" -> "el trabajo de prueba" (tray text and
  aria-label; Peru's form over ES "supervisado", AR "observado"). [PE, ES, AR]
- "El testigo se está armando..." -> "se está preparando...". [MX, ES, PE, CO]
- Correr family: meta "Corre un trabajo" -> "Haz un trabajo"; intro
  "corre un trabajo real" -> "ejecuta un trabajo real"; "Corre el
  trabajo de abajo" -> "Haz el trabajo de abajo"; steps "luego corre
  un trabajo" -> "luego haz un trabajo", "mientras el trabajo corre"
  -> "se ejecuta"; families row "antes de que corra cualquier
  herramienta" -> "se ejecute"; "el trabajo de arriba corrió" -> "se
  ejecutó"; "mientras corre un trabajo de Benchzy" -> "se ejecuta";
  airplane steps "Corre el trabajo de principio a fin" -> "Haz el
  trabajo", "ni programa que correr" -> "que ejecutar". [ES, CO, PE]
- "una página que se califica a sí misma vale poco" -> "el testimonio
  de la propia página vale poco". [CO, PE]
- "la promesa de esta página está rota" -> "significa que la promesa
  de esta página no se cumplió". [AR]

src/layouts/Base.astro, CHROME.es only (4):
- footHow "un alojamiento" -> "un servicio de hosting". [MX, PE, AR, CO]
- footUnderH "Bajo el mostrador" -> "Entre bastidores" (PE+ES form;
  settlement below). [all five flagged the heading]
- footUnder "Los motores son de código abierto" -> "Los programas son
  de código abierto". [MX, AR]
- Nav "Unir" -> "Unir PDF". [MX, CO]

src/locales/bg.js (1):
- heicNote "la misma ruta que el convertidor HEIC" -> "el mismo que
  usa el convertidor HEIC de este sitio". [all five]

src/scripts/witness.js, es strings only (3):
- beforeCount rewritten (Peru's form, with the agreement ternary the
  string already carried): "Se cargaron ${n} archivos. ${n - c} son
  pedidos de esta página a su propio sitio, para traer sus propias
  partes; ${c} corresponde/corresponden al contador de visitas, que se
  activó cuando la página se abrió." [PE, ES, AR, CO]
- verdict: "empezó a mirar (justo después de que esta página cargó)"
  -> "empezó a registrar (justo después de cargarse esta página)"
  [ES]; "el resto es esta página pidiendo a su propio sitio archivos
  de página y de programa" -> "el resto son pedidos de esta página a
  su propio sitio, por archivos de la página y del programa" [PE];
  "Peticiones con algo adjunto" -> "con datos adjuntos" [PE];
  "mientras corría el trabajo con testigo" -> "mientras se ejecutaba
  el trabajo de prueba" [ES, PE].
- done: "sin que ninguna petición lo llevara a ninguna parte" -> "sin
  que ninguna petición lo enviara a ningún sitio". [CO]

### Disagreements settled
- Footer heading: four candidate forms. "Entre bastidores" (PE, ES)
  chosen over "Del otro lado del mostrador" (MX, AR) and "Detrás del
  mostrador" (CO): two votes plus it matches the PT sibling "Nos
  bastidores" already live in the same footer.
- Hosting: the task-settled "un servicio de hosting" (PE, AR verbatim)
  over MX's "el servicio que hospeda el sitio" and CO's "están
  alojadas en Cloudflare Pages" construction.
- Data plan: "se descuentan de tu plan de datos" (CO's noun phrase,
  MX's verb) over AR "de tus datos móviles" and ES "de los datos de
  tu tarifa móvil".
- Speed sentences: PE's whole-sentence rewrites used on both pages
  instead of stitching the other four reports' phrase-level fixes.
- Carga/descarga unification NOT applied: CO asked to unify on
  "descarga"; PE had explicitly approved bg.js's "Carga detenida"
  line as written. A split panel does not move shipped UI strings;
  recorded in TRANSLATIONS.md.
- og:locale es_ES noted by MX and AR; a metadata decision for the
  owner, not a language fix; untouched.

### Verify
- npm run build clean (68 pages).
- Grep proof in src/: "pasadas en caliente" 0, "plan pago" 0,
  "tamaño pago" 0, "cuentan contra" 0, "un alojamiento" 0; also 0 for
  "corrida sana", "trabajo con testigo", "Bajo el mostrador",
  "de clase escritorio", "tiempo de teléfono", "uso privado",
  "se está armando", "comprueba contra", "la misma ruta que el
  convertidor HEIC", and no correr/corre/corrió forms remain in the
  Spanish pages or the witness es strings.
- Full verify/verify.mjs suite: VERIFY DONE, all 68 routes at
  errors: 0 / failed: 0, GA gate green on every route, witness gate
  (m19 form) green, m18 sections green (HEIC remover/batch/chain,
  OCR corrected PDF, landings, fast lanes, redirects), m19 section 15
  green. Run log: verify/m20-verify-run.log.
- verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings.
- TRANSLATIONS.md updated: the fixed items are marked reviewed by the
  five-country panel (simulated reviewers, stated plainly) and fixed
  in milestone 20; the register still states a real human review is
  outstanding.

### Counts and leftovers
- Counts unchanged: 68 pages, 50 tool pages, 22 working tools. A
  wording round: no page, no tool added.
- Nothing deployed, nothing pushed. Live site remains milestones
  18+19; this tree is milestones 18+19+20 local.

## Milestone 21 — final Spanish micro-pass from the round-2 panel (built 2026-11-09, LOCAL ONLY, not deployed, not pushed)

The five simulated country reviewers re-read the milestone-20 text and
all returned SAFE verdicts (reports:
~/workspace/file-toolkit/language-review-2026-11-09/round2/). This
round applies their short list of remaining one-line fixes, each with
its source report. Text only; no page, no tool added. Counts
unchanged: 68 pages, 50 tool pages, 22 working tools.

### Applied (task items 1–9)
1. witness.js `beforeCount` (es): "para traer sus propias partes" ->
   "para traerse los archivos que la forman" [ES R1 — the last
   round-1 Section A survivor].
2. Promise page: "El sitio se pagará con anuncios" -> "El sitio se
   financiará con anuncios" [ES R2].
3. Flagship FAQ: "los filamentos finos del borde" -> "los pelitos más
   finos del borde" [PE R2-1].
4. ES nav label (CHROME.es): "Leer un escaneo" -> "Leer un documento
   escaneado" [AR R1].
5. Flagship StepsStrip: "el trabajo de todos los días" -> "el trabajo
   de cada día" [MX R2-2].
6. Flagship "Cómo funciona": "con los pesos publicados" -> "con los
   pesos del modelo publicados", parenthetical kept as is [panel
   item; MX R2-1 / PE R2-3 / AR R3 / CO R8 all circled this sentence].
7. Download-flow noun unified on "descarga" in the ES bg flow
   [CO R1 — the round-2 panel's top remaining item; it reverses the
   milestone-20 split-panel hold, on the owner's launch instruction]:
   bg.js `cancelled`: "Carga detenida." -> "Descarga detenida." and
   "la carga sigue desde ahí" -> "la descarga sigue desde ahí";
   flagship prose + HowTo step: "la carga puede tardar un minuto o
   más" -> "la descarga…" (x2), "Puedes cancelar la carga cuando
   quieras" -> "…la descarga…" (x2), "la próxima vez la carga sigue
   desde ahí" -> "…la descarga…" (x2); full-res FAQ: "la carga puede
   tardar" (x1), "La carga se puede cancelar cuando quieras" -> "La
   descarga se puede cancelar…" (x1). Boundary kept: verb forms
   (se carga, Cargando, cargado) untouched — they also describe
   loading from the local cache, where "descargando" would be false;
   "Archivo cargado:/Archivos cargados:" untouched (the visitor's
   picked file, not the program download). No EN or PT string touched.
8. "panel Red" -> "panel de red" (compruebalo-tu-mismo steps) [ES R3,
   CO R7 — the two reviewers disagreed on which form wins; the task
   settled it for "panel de red", matching the flagship FAQ's existing
   wording]. Same step, ES R3's second half with the house verb:
   "Presiona el botón de borrar de la lista de red y luego haz un
   trabajo…" -> "Presiona el botón de vaciar la lista (el icono de
   prohibido) y después haz un trabajo…".
9. Flagship FAQ: "la herramienta lo dice en vez de inventarse un
   recorte" -> "la herramienta lo avisa en vez de inventarse un
   recorte" [AR R2]. (The promise page's different sentence "la
   herramienta lo dice en palabras claras" was not the quoted item
   and is unchanged.)

### Applied (task item 10 — verbatim one-line swaps from the reports)
- "Una cosa más se carga:" -> "Se carga una cosa más:" [ES R4].
- "y un trabajo no le envía nada" -> "y ningún trabajo le envía
  nada" [ES R5].
- "No hay nada que cancelar porque no hay nada a lo que unirse" ->
  "No hay nada que cancelar porque no te suscribes a nada" [CO R2].
- bg.js `specNoneValue` (es): "todavía ninguno" -> "ninguno
  todavía" [ES R6].
- "antes de que se descargue nada" -> "antes de descargar nada"
  [PE R2-2].
- "Las líneas son esta página pidiendo a su propio sitio…" -> "Las
  líneas muestran a esta página pidiendo a su propio sitio…"
  [PE R2-4].
- Footer `footUnder` (es): "…y funcionan desde este sitio" -> "…y se
  cargan desde este sitio" [CO R3].

### Skipped, with reasons
- MX R2-1's alternative for the ISNet sentence ("un modelo ISNet de
  código abierto…") and the full nested-parenthesis restructures
  (PE R2-3, AR R3, CO R8): superseded by task fix 6, which keeps the
  parenthetical and swaps only "pesos" -> "pesos del modelo".
- CO R4 "Comprobar tamaño" -> "Revisar tamaño": the reviewer himself
  classes it as regional preference, not an error; "Comprobar" stands
  under the neutral Latin American standard.
- CO R5 "Lo premium es gratis aquí" rewrite: campaign headline copy,
  not a translation error; AR's round-2 report explicitly praised
  the line as it stands. Split panel + copy judgment — left for the
  owner, unchanged.
- CO R6 (split the flagship intro paragraph): layout restructure,
  not a one-line swap.
- MX R2-3 (og:locale es_ES) and ES R7 (og:image:alt localization):
  metadata, out of scope for this pass by instruction; unchanged.

### Verify
- npm run build clean (68 pages).
- verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings.
- Grep proof in src/: all 21 replaced strings return 0 ("para traer
  sus propias partes", "El sitio se pagará", "los filamentos finos
  del borde", "Leer un escaneo", "trabajo de todos los días",
  "con los pesos publicados (", "panel Red", "la herramienta lo dice
  en vez", "Una cosa más se carga", "un trabajo no le envía nada",
  "a lo que unirse", "todavía ninguno", "Carga detenida",
  "antes de que se descargue nada", "Las líneas son esta página",
  "funcionan desde este sitio", "botón de borrar de la lista",
  "cancelar la carga", "La carga se puede cancelar",
  "la carga puede tardar", "la carga sigue desde ahí").
- Full verify/verify.mjs suite: VERIFY DONE, exit 0, all 68 routes
  at errors: 0 / failed: 0, 0 GATE FAIL lines, GA gate green on every
  route, witness gate (m19 form) green. Run log:
  verify/m21-verify-run2.log. (The first attempt's log,
  verify/m21-verify-run.log, is NOT a pass: that process was killed
  mid-run after a browser TargetCloseError in the m12 watermark
  screenshot step; the suite was re-run from scratch and the second
  run is the green one.)
- TRANSLATIONS.md: the milestone-20 "left as-is" entry for
  carga/descarga now carries a milestone-21 addendum recording that
  the unification was applied here.

### Counts and leftovers
- Nothing deployed, nothing pushed. Live site remains milestones
  18+19; this tree is milestones 18+19+20+21 local. The Spanish fix
  (20+21) is ready for the parent's deploy decision.
- MILESTONES 20+21 DEPLOYED (2026-11-09): the five-country Spanish fix (50 replacements in m20 + 17 micro-swaps in m21; all five simulated reviewers returned SAFE verdicts in round 2). Wrangler Direct Upload from inside dist, deployment ef9c44e9.benchzy.pages.dev. Live checks: all 68 sitemap URLs 200; the ES flagship carries the fixes ("un servicio de hosting", "pelitos más finos", new nav label) and none of the killed calques; the ES promise page carries "se financiará con anuncios" and "de pago" forms. IndexNow retried for all 68: 403 on both endpoints again (0 accepted).

## Milestone 22 — external-audit fix round: build notes off public pages, real 404, tool first (built 2026-11-10, LOCAL ONLY, not deployed, not pushed)

Three surgical fixes ordered by the owner from an external audit.
Counts unchanged: 68 content pages, 50 tool pages, 22 working tools
(the build now emits 69 HTML files; the extra one is the 404 utility
page, counted nowhere public).

### Fix 1 — internal build notes removed from public pages
Removed, in full:
- src/pages/tools.astro, the Spanish remover entry's note:
  "…con su página a resolución completa. Spanish strings drafted
  in-house, marked pending human review in the project notes." —
  the note now ends at "…resolución completa."
- src/pages/tools.astro, the Portuguese entry's note: the same
  build-note sentence ("Portuguese strings drafted in-house,
  marked pending human review in the project notes.") removed;
  the note now ends at "…alternativa grátis ao remove.bg."
- src/pages/background-removal.astro, the "same tool, in Spanish
  and Portuguese" section: "The strings were drafted in-house and
  are marked in the project notes as pending review by a native
  reader before any public launch." removed; the paragraph now ends
  at "…searching in."
Sweep for the same class across every public page (rendered strings
in src/pages, src/components, src/layouts, src/locales): those were
the only three passages. Remaining grep hits for the phrases are
code comments only (12 files: page frontmatter, BgTicket.astro,
locales/bg.js, remove-bg.js, witness.js) — internal, not rendered,
untouched per the fix's own scope. Proof: the strings return 0 in
non-comment source lines and 0 in all built dist HTML.

### Fix 2 — real 404
Diagnosed cause: the site had NO 404 page. dist/_redirects holds
only the four language 301 rules (no catch-all), and the service
worker passes navigation responses through unchanged — neither was
the cause. With no dist/404.html present, Cloudflare Pages falls
back to serving the homepage (dist/index.html) with HTTP 200 for
every unmatched path, including missing assets. Reproduced locally
under `wrangler pages dev` on the pre-fix dist: /definitely-not-a-
page/ -> 200 with the homepage body, /nope.png -> 200; adding a
probe 404.html to a copy of the same dist flipped both to a true
404 while routes and the 301 stayed put.
Fix shipped: src/pages/404.astro (built to dist/404.html), plain
and on-brand in the ledger style — "That page is not on this bench",
a back-to-homepage button, and a door list (All the tools, Remove
background, Compress PDF, Compress image). Base.astro gained an
optional `noindex` prop (default off; only the 404 page sets it),
rendering <meta name="robots" content="noindex">. The 404 page is
kept out of every public count and list, deliberately:
- src/pages/sitemap.xml.js filters the '/404/' route out of the
  glob-derived list (sitemap still lists exactly 68 URLs).
- src/pages/what-free-means.astro excludes './404.astro' from its
  build-time page count (printed counts unchanged: 68 / 50 / 22).
- verify/seo-audit.mjs excludes '404.astro' from its page recount
  in step, with the reason in a comment beside the change.
Verified against the NEW dist under wrangler pages dev:
unknown path -> 404 with the branded page; /nope.png -> 404;
/, /remove-background/, /compress-pdf/ -> 200; /es/quitar-fondo/
and /pt/remover-fundo -> 301 as before; /favicon.svg and /sw.js
-> 200. The service worker file is untouched, and its offline
behaviour for visited pages is unchanged (the suite's
service-worker gate — caches + offline reopen — passed in this
run). Live 404 status to be confirmed by the parent after deploy.

### Fix 3 — tool first on every tool page
The milestone-8 order (steps + who-is-this-for above the tool) is
reversed on all 49 tool pages: the tool block (file tray + its
controls) now sits directly under the page title and one-line
intro; the steps strip and any explainer sections moved below it,
relative order otherwise preserved. Nothing was deleted: the
reorder was done mechanically per file with a proof that the
multiset of non-blank lines is identical before and after.
- 37 pages with a tool <section> (all batch pages, all compress
  doors and presets, extract/flatten/HEIC/interleave/JPG-to-PDF/
  merge/OCR x2/organise/metadata/page-numbers/PDF-to-JPG/protect/
  resize/rotate/size-checker/split/watermark, and /workflows/).
- sign-pdf and unlock-pdf also carried an explainer section above
  the tool ("What this is, and what it is not" / "Two kinds of
  password"); explainer + steps both moved below the tool.
- 6 BgTicket pages: /remove-background/, the full-resolution page,
  ES quitar-fondo + resolución completa, PT remover-fundo +
  alternativa.
- 6 convert doors (the ConvertDoor tray): PNG/JPG/WebP pairs.
Already tool-first, unchanged: /presets/ (the preset cards with
their save buttons sit at the top; the steps strip was already
below them) and the check-it-yourself family EN/ES/PT (the live
witness is directly under the header; it carries no steps strip).
Homepage untouched, per the order.
Gate change (deliberate, recorded here as required): no earlier
gate asserted the old order. verify.mjs gained section 16, which
asserts the NEW order: (a) a static gate over the built HTML of
all 49 routes — tool marker before the steps strip, steps strip
still present; (b) rendered-top evidence on a sample (EN
/compress-pdf/ tray 407px vs steps 983px; ES flagship tray 662px
vs steps 1122px; /jpg-to-png/ tray 407px vs steps 836px);
(c) the 404 build facts above. Screenshots:
verify/screenshots/m22-compress-pdf-desktop.png and
m22-compress-pdf-mobile.png — tray directly under the intro on
both; on mobile the tray is inside the first screen.

### Verify
- npm run build clean (69 files: 68 content pages + 404.html).
- verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings (dist pages
  68, sitemap 68 locs, 48 hreflang links, counts 22/50/68 match).
- Full verify/verify.mjs suite: VERIFY DONE on the second attempt
  (log verify/m22-verify-run.log): all 68 routes at console errors
  0 / failed requests 0, 0 GATE FAIL lines, GA gate green on every
  route, witness gate green, m22 section green (49/49 order,
  rendered tops, 404 facts). The first attempt
  (verify/m22-verify-run1-crashed.log) is NOT a pass: it died
  partway in the milestone-6 batch-remove-background gate on a
  900 s wait under sandbox CPU load — the known load flake class
  from milestones 19/21; the batch gate passed in the re-run.
- Nothing deployed, nothing pushed. Live site remains milestones
  18+19+20+21; this tree is milestones 18-22 local.
- MILESTONE 22 DEPLOYED (2026-11-10): the three Fable-audit fixes (build notes off public pages, real 404 via the new branded 404 page, tool-first reorder on 49 tool pages). Wrangler Direct Upload from inside dist, deployment 7b3d4619.benchzy.pages.dev. Live checks: all 68 sitemap URLs 200; /definitely-not-a-page/ and /nope.png return true 404 with the branded page; /tools/ carries none of the removed note strings; compress-pdf serves the tray before the steps; the ES 301 is intact. IndexNow retried for all 68: 403 on both endpoints again (0 accepted).

## Milestone 23 — AdSense site-side prep: ads.txt, the loader, and the naming the site promised (built 2026-11-11, LOCAL ONLY, not deployed, not pushed)

Owner-ordered site-side preparation for Google AdSense. No ad
units were placed and no account-side work was done; this is the
code and copy side only. Counts unchanged: 68 content pages, 50
tool pages, 22 working tools (dist still emits 69 HTML files; the
extra one is the milestone-22 404 utility page, and dist/ads.txt
is a text file, not a page).

### What shipped
- public/ads.txt (new): exactly one line and nothing else —
  "google.com, pub-1450356163101033, DIRECT, f08c47fec0942fa0"
  plus its single trailing newline. Builds to dist/ads.txt
  (59 bytes, verified with od).
- src/layouts/Base.astro: the standard AdSense loader for this
  publisher, in the head beside the GA4 tag, rendered verbatim
  (is:inline) exactly once per page on every route and locale:
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1450356163101033" crossorigin="anonymous"></script>
  The GA4 tag (G-PSWNWPP7PY) is untouched. The service worker
  needed no change: it only ever handles same-origin GETs, so the
  cross-origin loader passes through it untouched.

### Copy changes (truth-in-copy: the naming the site promised)
The site promised the ad network would be named before ad code
ran. This milestone is that moment; the network is Google
AdSense. Every passage that described the counter as the only
outside call at page load, or the naming as a future event, was
corrected to the new truth: at page load the page calls Google
for the visit counter AND the Google AdSense loader; during a
tool run nothing new is called and files never leave the browser.
- src/pages/privacy.astro: meta description now says "ads served
  by Google AdSense" (was "no ad scripts"); the server-keeps
  section no longer says "no advertising script runs on these
  pages" — it now says two outside scripts run when a page opens
  and both are named on the page (the counter, and the ad
  network's loader); the "Ads, stated plainly" section now names
  Google AdSense, states its loader is on every page and loads
  when a page opens, and says what it can see (the visit itself:
  which page opened, roughly where the connection comes from,
  device and browser kind; Google keeps what it collects under
  its own rules). The "an ad can never see your file" paragraph
  is unchanged — it is still true. The GA counting section is
  unchanged in substance. The frontmatter comment was updated to
  record the naming, in the same discipline as milestone 19.
- Witness family, pages (EN check-it-yourself.astro, ES
  compruebalo-tu-mismo.astro, PT confira-voce-mesmo.astro), same
  three spots in each: the "any page on this site" family row now
  says two more things load, both from Google (counter + ad
  loader), and that their lines are labelled "visit counter" and
  "ad loader"; step 4 of the manual network-panel check now names
  both lines; the "healthy run" paragraph now excepts both lines.
- Witness family, script (src/scripts/witness.js): the ad loader
  gets exactly the counter's treatment (the milestone-19
  pattern): requests to pagead2.googlesyndication.com are listed,
  labelled "ad loader" (ES "cargador de anuncios", PT
  "carregador de anúncios") and counted in their own bucket; the
  before-count, verdict and job-done strings in all three locales
  now report the loader bucket alongside the counter's. Without
  this the witness's own printed arithmetic ("the rest are this
  page asking its own site…") would have stopped being true the
  moment the loader landed. The new ES/PT witness strings are
  in-house drafts of the same standing as the rest of the ES/PT
  witness copy (TRANSLATIONS.md).
- Promise pages (what-free-means.astro, ES
  que-significa-gratis-aqui.astro, PT o-que-significa-gratis.astro):
  the "why it can be free" passage no longer says "no ads run
  yet / when ads come"; it now says the site is paid for by ads
  on the pages, served by Google AdSense, whose loader is on the
  pages now and which is named on the privacy page, and keeps the
  file sentence: an ad can see the page, never the file.
- Homepage FAQ (src/pages/index.astro): the "Is it really free?"
  answer carried the same future-tense sentence; it now reads
  "The site is paid for by ads on the pages, served by Google
  AdSense, named on the privacy page."
- public/llms.txt: the summary line carried the same "will be
  paid for / no ads run yet / when ads come" wording; corrected
  the same way.
Sweep proof: after the edits, the killed claims ("No ads are
served on Benchzy yet", "no advertising script runs", "will be
named on this page before", "no ads run yet", "will be paid for
by ads", ES "todavía no se muestra ningún anuncio", PT "nenhum
anúncio roda ainda") return 0 in src/pages, src/scripts and
public/llms.txt.

### Gate changes (deliberate, recorded here as required)
verify/verify.mjs, all changes in the milestone-19 pattern
(intercept, record, stand-in) extended to the new host:
- Harness interception: pagead2.googlesyndication.com requests
  are recorded per page and answered with an empty stand-in. The
  stand-in carries Access-Control-Allow-Origin: * because the
  loader tag ships with crossorigin="anonymous" and the real file
  is served CORS-open; without the header Chrome rejects the
  stand-in itself (the first m23 run failed on exactly that: the
  witness gate's own assertions passed but every page carried the
  CORS console error; log kept as verify/m23-verify-run1-cors.log,
  NOT a pass).
- New per-route gate: exactly one loader request carrying
  client=ca-pub-1450356163101033 on every route in the loop
  (ADS GATE line in the log; routes that miss throw after the
  loop, like the GA gate). The GA per-route assertions are
  unchanged and still green.
- Witness gate, m23 form: the job-done string now reports two
  buckets, so the parsed assertion is requests-during-job minus
  counter's own minus ad loader's own == 0, with-body still == 0,
  and the labelled-rows evidence gains "ad loader" rows >= 1.
- Section 15 (m19): the privacy wording gate also asserts the
  page names Google AdSense and carries none of the killed
  sentences; the background-removal run gate's tolerated
  load-time hosts gain the loader's one host beside the
  counter's, with the reason recorded in the section header (the
  loader fires at load, before the run window opens; the run
  assertion itself — no body anywhere, no other cross-origin
  host — is unchanged).
- New section 17 (static): dist/ads.txt byte-exact, and the full
  loader URL occurs exactly once in every built HTML page
  (69 files: 68 content + 404).

### Verify
- npm run build clean (69 pages; ads.txt at dist root).
- verify/seo-audit.mjs: ALL CHECKS PASSED, 0 warnings (dist pages
  68, sitemap 68 locs, counts 22/50/68 match — ads.txt is not a
  page and enters no count).
- Full verify/verify.mjs suite: VERIFY DONE on the second attempt
  (log verify/m23-verify-run.log): all 68 routes at console errors
  0 / failed requests 0; GA GATE green on every route; ADS GATE
  green on every route; witness (m23 form): 0 requests during the
  job, counter rows labelled 2, ad-loader rows labelled 1; m19 GA
  homepage green; m19 privacy wording true (with the new AdSense
  assertions); m19 BG run sends: 0 with body, 0 cross-origin;
  m22 order 49/49 and 404 facts green; m23 section 17: ads.txt
  byte-exact, 69 built HTML pages, loader-count fails 0. The run
  included one long sandbox stall in the m12 watermark stretch
  (~17 min at near-zero CPU under memory pressure, the known load
  class from milestones 19/21/22); it broke loose and the suite
  completed clean.
- Nothing deployed, nothing pushed. Live site remains milestones
  18+19+20+21+22; this tree is milestones 18-23 local.
- MILESTONE 23 DEPLOYED (2026-11-11): AdSense site-side prep. ads.txt live with the exact single line (google.com, pub-1450356163101033, DIRECT, f08c47fec0942fa0); the loader is on every page exactly once; GA4 tag untouched; /privacy/ names Google AdSense and the witness family labels the ad loader like the counter. Wrangler Direct Upload from inside dist, deployment 68882ee3.benchzy.pages.dev. Live checks: /ads.txt 200 with the byte-exact line; loader count 1 on /, /remove-background/, /privacy/; GA ID present on all sampled pages; all 68 sitemap URLs 200; nonsense path still a true 404. Console-side: benchzy.com already added in AdSense; verify + review request runs from the main chat now that this is live.
