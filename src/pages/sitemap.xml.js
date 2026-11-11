// sitemap.xml, generated at build time from the pages that actually
// exist in src/pages (milestone 5). The route list is derived from the
// page files, never typed, so a new page enters the sitemap on its own
// and a removed page leaves it. The two background-removal language
// clusters carry hreflang alternates, matching the clusters the pages
// themselves declare (milestone 4); every other page is a plain entry.
const pageFiles = import.meta.glob('./**/*.astro');

const SITE = 'https://benchzy.com';

function fileToRoute(file) {
  let p = file.replace(/^\.\//, '').replace(/\.astro$/, '');
  if (p === 'index') return '/';
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return '/' + p + '/';
}

// Milestone 22: the 404 page is a utility page, never a sitemap
// entry; it is filtered out here by its would-be route.
const routes = Object.keys(pageFiles).map(fileToRoute).filter((r) => r !== '/404/').sort();

// Language clusters: route -> { hreflang: route }. x-default is the
// English page of each cluster, as the pages' own alternates declare.
const CLUSTERS = [
  {
    en: '/remove-background/',
    es: '/es/quitar-fondo-de-imagen-gratis/',
    'pt-BR': '/pt-br/remover-fundo-de-imagem-gratis/',
  },
  {
    en: '/remove-background-full-resolution/',
    es: '/es/quitar-fondo-resolucion-completa/',
    'pt-BR': '/pt-br/alternativa-gratis-ao-remove-bg/',
  },
  // Trust-page clusters (milestone 8): the promise page and the proof
  // page, fully translated, wired both ways like the pages declare.
  {
    en: '/what-free-means/',
    es: '/es/que-significa-gratis-aqui/',
    'pt-BR': '/pt-br/o-que-significa-gratis/',
  },
  {
    en: '/check-it-yourself/',
    es: '/es/compruebalo-tu-mismo/',
    'pt-BR': '/pt-br/confira-voce-mesmo/',
  },
];
const clusterOf = new Map();
for (const cluster of CLUSTERS) {
  for (const route of Object.values(cluster)) clusterOf.set(route, cluster);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function GET() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const entries = routes.map((route) => {
    const lines = [`  <url>`, `    <loc>${esc(SITE + route)}</loc>`, `    <lastmod>${lastmod}</lastmod>`];
    const cluster = clusterOf.get(route);
    if (cluster) {
      for (const [hreflang, target] of Object.entries(cluster)) {
        lines.push(`    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${esc(SITE + target)}"/>`);
      }
      lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(SITE + cluster.en)}"/>`);
    }
    lines.push('  </url>');
    return lines.join('\n');
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
