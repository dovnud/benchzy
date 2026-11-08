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

## What a reviewer receives

This file, the four pages rendered, and `src/locales/bg.js`. Changes go
into the locale file and the page frontmatter only; the island reads
everything from the locale file, so no code changes are needed for a
wording pass.
