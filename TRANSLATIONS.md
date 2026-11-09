# TRANSLATIONS.md — the localised background-removal set (wave 1A, items 4–7)

Date: 2026-11-08. LOCAL ONLY: nothing here is published.

## Status, stated plainly

**The Spanish and Portuguese strings on this site were drafted in-house and
are PENDING HUMAN REVIEW before any public launch.** No native-speaker
reviewer has read them yet. The pages are built and verified as software;
they are not cleared as language. A human reviewer for each language must
read every string below before the site goes public, and the launch
checklist does not pass without that.

Scope of the drafted strings:
- `src/locales/bg.js` — the background-removal island's runtime messages
  and the job-ticket furniture, in en (source of truth), es and pt-BR.
- The four localised pages: `/es/quitar-fondo-de-imagen-gratis/`,
  `/es/quitar-fondo-resolucion-completa/`,
  `/pt-br/remover-fundo-de-imagem-gratis/`,
  `/pt-br/alternativa-gratis-ao-remove-bg/` (heroes, how-it-works, honest
  limits, FAQs and FAQ schema with `inLanguage` set).
- The nav and footer chrome for es / pt-BR in `src/layouts/Base.astro`
  (the tools the chrome names, other than background removal, are still
  English pages; their links stay on the English routes).

Drafting rules followed: natural tool-domain language over word-for-word
rendering; the search phrases people actually type kept intact as page
titles ("quitar fondo de imagen gratis", "remover fundo de imagem
grátis", "alternativa grátis ao remove.bg"); decimal commas (44,3 MB);
no claim on a localised page that the English pages do not make (no
speed or quality promises; the measured facts carry the same dates).

## Strings most at risk of sounding off (review these first)

1. **The stamp line.** EN "Done on your device" → ES "Hecho en tu
   dispositivo", PT "Feito no seu dispositivo". It is the brand's stamp
   device; a reviewer should judge whether it lands as a workshop stamp
   or reads as a flat statement, in each language.
2. **The job-ticket kicker.** EN "Job ticket" → ES "Orden de trabajo",
   PT "Ordem de serviço". Chosen as the real print-shop terms; the ES
   one is long and bureaucratic in some regions ("orden de trabajo" is
   also a maintenance form), the PT one is standard for service shops.
3. **"Ordenador de sobremesa" (ES FAQ).** Spain's term for a desktop
   computer; most of the Spanish-speaking audience is Latin American,
   where "computadora de escritorio" is the everyday phrase. Regional
   call for the reviewer.
4. **"Tamaño completo" vs "resolución completa" (ES).** The full-size
   page's title and H1 use "resolución completa"; the body and the tool
   pages use "tamaño completo". Both are real search language; a
   reviewer should confirm the mix reads as one idea, not two.
5. **"Tamanho real" (PT) for full resolution.** Used throughout instead
   of "resolução completa" because it is how Brazilian tools phrase the
   promise; a reviewer should confirm it cannot be misread as a claim
   about physical print size.
6. **The tray.** EN "Drop a photo on the tray" → ES "Suelta una foto en
   la bandeja", PT "Solte uma foto na bandeja". "Bandeja" is a tray in
   both languages (and an inbox in email contexts); the print-shop
   reading depends on the page's design carrying it.
7. **"Verificación / verificadas" (ES) and "verificação / verificadas"
   (PT)** for the model-piece hash checks. Plain and correct, but
   "comprobación" (ES) is also common; the hash-check wording is the
   site's proof language, so its exact register matters.
8. **The no-subject message.** ES "No se encontró un sujeto claro." /
   PT "Nenhum assunto claro foi encontrado." Tone check: it must read
   as honest workshop speech, not as a system error.
9. **Error messages.** The island's failure lines (a piece "llegó con un
   tamaño incorrecto; no se ejecutó nada" / "chegou com o tamanho
   errado; nada foi executado") were written to stay calm and factual;
   a reviewer should check they do not sound like machine output.
10. **Footer idiom.** EN "Under the counter" → ES "Bajo el mostrador",
    PT "Debaixo do balcão". The counter is the print-shop counter; both
    renderings lean on the page design to carry that reading, and "bajo
    el mostrador" has an off-the-books echo in some regions.
11. **PT nav "Ler digitalização"** (for "Read a scan"). Compressed for
    the nav; a reviewer may prefer "Ler um documento digitalizado" at
    the cost of length.
12. **Download file-name suffixes.** Cutouts download as
    `…-sin-fondo.png` (ES) and `…-sem-fundo.png` (PT). Short and
    searchable, but they are the one string a visitor keeps on their own
    machine; worth a reviewer's explicit yes.

## Milestone 8 additions (2026-11-08, round-1 user-test fixes)

The round-1 simulated-user panel read the ES and PT pages and named
specific strings as wrong or off. Milestone 8 fixed them in-house; all
ES/PT text remains an in-house draft, PENDING HUMAN REVIEW, exactly as
before. Nothing in this section has been reviewed by a native speaker.

RESOLVED from the register above:
- Item 3 ("ordenador de sobremesa"): replaced everywhere with
  "computadora de escritorio" (neutral Latin American). The ES pages
  were re-localized to neutral LatAm throughout: "en directo" →
  "en vivo", "¿Adónde…" → "¿A dónde…", "el cristal" → "el vidrio",
  "con la maquinaria de tu navegador" → "dentro de tu navegador",
  "nivel de pago" / "resultado verdadero" → "plan pago" / "resultado a
  tamaño completo", "uso privado" (PT calque) → "uso pessoal".
- Item 6 (the tray): ES "Suelta una foto en la bandeja" → "Suelta una
  foto aquí"; PT "Solte uma foto na bandeja" → "Solte uma foto aqui";
  the bg.js tray titles likewise ("Suelta una foto aquí…" / "Solte uma
  foto aqui…").
- Item 8 (no-subject): ES "el sujeto" → "la figura" everywhere incl.
  the island messages ("No se distinguió una figura clara."); PT "o
  assunto" → "a figura" everywhere incl. error and status messages
  ("Nenhuma figura clara foi encontrada.").
- Item 10 (footer heading): PT "Debaixo do balcão" → "Nos bastidores".
  The ES "Bajo el mostrador" was NOT named by the panel and stays, with
  its at-risk note above unchanged. Also fixed on the PT alternative
  page: "O remove.bg fecha o seu site…" (which read as Benchzy closing)
  → "O próprio site do remove.bg fecha…".

NEW at-risk strings added by milestone 8 (review these too):
13. **Cancel button + cancelled status** (bg.js, ES/PT): "Cancelar la
    descarga" / "Cancelar o download"; the stopped-load status ("La
    carga se detuvo. Ya llegaron N de 11 piezas y se quedan guardadas…"
    / "O carregamento parou. N de 11 partes já chegaram e ficam
    guardadas…"). New UI vocabulary; tone check wanted.
14. **Data-plan sentences** on the four localized BG pages (mobile
    data, Wi-Fi, slow-connection time, cancel-and-resume), drafted to
    match the English.
15. **Promises strip + HEIC note** (bg.js, ES/PT): the four short
    promises beside the tray and above the download button, and the
    HEIC-not-accepted note, in both languages.
16. **Two full trust pages per language**: /es/que-significa-gratis-aqui/
    + /es/compruebalo-tu-mismo/ and /pt/o-que-significa-gratis/ +
    /pt/confira-voce-mesmo/ — complete translations of the promise page
    and the proof page, including the never list, the witness furniture,
    and the family table. The witness script's own runtime strings
    (verdict, status lines, format names) were localized in
    src/scripts/witness.js for es and pt-BR.
17. **Footer trust links + privacy label** (Base.astro chrome):
    "Privacidad" / "Privacidade", and the ES/PT footer now links the
    localized trust pages instead of the English ones.
18. **Steps strips** on the four localized BG pages (who-line + three
    steps at the top of each page), and the two static redirect pages
    (/es/quitar-fondo/, /pt/remover-fundo/) with one line each.
19. **Visit-counter wording (milestone 19, 2026-11-09)**: the witness
    family table row, the network-panel step 4, and the bad-line intro
    on /es/compruebalo-tu-mismo/ and /pt-br/confira-voce-mesmo/ were
    rewritten to name the Google Analytics visit counter; the
    "Sin contadores diarios"/"Sem contadores diários" entry on the
    free-means pages gained the visits-are-counted sentence; and the
    witness script's runtime strings (beforeCount, verdict, done) in
    src/scripts/witness.js gained the counter bucket in es and pt-BR.
    Same in-house draft status as the rest of the set.

## What a reviewer receives

This file, the four pages rendered, and `src/locales/bg.js`. Changes go
into the locale file and the page frontmatter only; the island reads
everything from the locale file, so no code changes are needed for a
wording pass.
