// Milestone 10 fixture texts: the exact strings rendered into the OCR
// fixture pictures by verify/m10-make-fixtures.mjs, imported by both
// that generator and verify/verify.mjs so the accuracy gates compare
// against what was actually rendered. Plain ASCII on purpose, so the
// known string is the whole story.
export const BIG_TEXT = [
  'INVOICE 2026-TEST-0042',
  '',
  'Thank you for your order. This invoice lists the items you bought from',
  'the workshop on 4 November 2026. Please check every line against your',
  'own records before you pay, and keep this page for your files.',
  '',
  '2 x Widget, standard size . . . 84.00',
  '1 x Bracket, brass . . . 16.50',
  'Delivery . . . 24.00',
  '',
  'Total due: 124.50',
  '',
  'Payment is due within fourteen days. If a number on this page looks',
  'wrong, write to the office and say which line, and we will check it',
  'against the order book the same day.',
].join('\n');

// The small fixture renders exactly the same text, smaller.
export const SMALL_TEXT = BIG_TEXT;

export const ES_TEXT = [
  'FACTURA 2026-PRUEBA-0042',
  '',
  'Gracias por su pedido. Esta factura enumera los articulos que compro',
  'en el taller el 4 de noviembre de 2026. Revise cada linea contra sus',
  'propios registros antes de pagar, y guarde esta pagina en sus archivos.',
  '',
  'Total a pagar: 124,50',
  '',
  'Si un numero parece incorrecto, escriba a la oficina e indique la linea.',
].join('\n');

export const PT_TEXT = [
  'FATURA 2026-TESTE-0042',
  '',
  'Obrigado pelo seu pedido. Esta fatura lista os itens que voce comprou',
  'na oficina em 4 de novembro de 2026. Confira cada linha contra os seus',
  'registros antes de pagar, e guarde esta pagina nos seus arquivos.',
  '',
  'Total devido: 124,50',
  '',
  'Se um numero parecer incorreto, escreva para o escritorio e indique a linha.',
].join('\n');

// Character accuracy: 1 - levenshtein/max length, after collapsing
// every whitespace run to one space (line breaks are the renderer's,
// not the text's). Case and punctuation still count.
export function charAccuracy(recognised, known) {
  const a = String(recognised || '').replace(/\s+/g, ' ').trim();
  const b = String(known || '').replace(/\s+/g, ' ').trim();
  if (!b.length) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
