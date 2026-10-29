// Emits robots.txt + sitemap.xml + static hubs/guides/legal + Markdown mirrors +
// llms.txt into web/dist, then self-verifies the output.
// Runs as the tail of `npm run build --workspace=web`:
//   vite build && node --import ../scripts/register-ts.mjs ../scripts/seo-build.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUIDES,
  HUB,
  LEGAL,
  SEO_BASE_URL,
  SEO_PAGES,
  guidePath,
  hubPath,
  footerNav,
  legalPath,
} from '../web/seo/content.ts';
import {
  contentHead,
  contentShell,
  guideJsonLd,
  guideMarkdown,
  hubJsonLd,
  hubMarkdown,
  legalJsonLd,
  legalMarkdown,
  llmsTxt,
  renderGuide,
  renderHub,
  renderLegal,
  robotsTxt,
  sitemapXml,
} from '../web/seo/render.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web', 'dist');
if (!existsSync(dist)) {
  console.error('seo-build: web/dist missing, run vite build first');
  process.exit(1);
}

const LOCALES = ['es', 'en'];
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dist, 'robots.txt'), robotsTxt(SEO_BASE_URL));
writeFileSync(
  join(dist, 'sitemap.xml'),
  sitemapXml(
    SEO_BASE_URL,
    SEO_PAGES.map((p) => p.path),
    today,
  ),
);

const mdUrl = (path) => `${SEO_BASE_URL}${path}index.md`;
const llmsHubs = [];
const llmsGuides = [];

const emitPage = (relPath, html, md) => {
  const dir = join(dist, ...relPath.split('/').filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'index.md'), md);
};

for (const locale of LOCALES) {
  const hub = HUB[locale];
  const other = locale === 'es' ? 'en' : 'es';
  const nav = footerNav(locale);
  const guides = GUIDES.map((g) => ({
    path: guidePath(locale, g),
    h1: g.copy[locale].h1,
    lede: g.copy[locale].lede,
  }));
  const head = contentHead(SEO_BASE_URL, {
    locale,
    path: hubPath(locale),
    title: hub.title,
    description: hub.description,
    alternates: LOCALES.map((l) => ({ locale: l, path: hubPath(l) })),
    jsonLd: hubJsonLd(SEO_BASE_URL, hubPath(locale), locale, hub.faqs),
    mdPath: `${hubPath(locale)}index.md`,
  });
  emitPage(
    hubPath(locale),
    contentShell(locale, head, renderHub(locale, hub, hubPath(other), guides, nav)),
    hubMarkdown(
      SEO_BASE_URL,
      { mdUrl: mdUrl(hubPath(locale)), htmlUrl: SEO_BASE_URL + hubPath(locale) },
      hub,
      guides,
    ),
  );
  llmsHubs.push({ locale, mdUrl: mdUrl(hubPath(locale)), h1: hub.h1, lede: hub.lede });

  for (const g of GUIDES) {
    const copy = g.copy[locale];
    const path = guidePath(locale, g);
    const ghead = contentHead(SEO_BASE_URL, {
      locale,
      path,
      title: copy.title,
      description: copy.description,
      alternates: LOCALES.map((l) => ({ locale: l, path: guidePath(l, g) })),
      jsonLd: guideJsonLd(copy),
      mdPath: `${path}index.md`,
    });
    emitPage(
      path,
      contentShell(locale, ghead, renderGuide(copy, hub, hubPath(locale), guidePath(other, g), nav)),
      guideMarkdown(SEO_BASE_URL, { mdUrl: mdUrl(path), htmlUrl: SEO_BASE_URL + path }, copy, hubPath(locale)),
    );
    llmsGuides.push({ locale, mdUrl: mdUrl(path), h1: copy.h1, lede: copy.lede });
  }

  for (const e of LEGAL) {
    const copy = e.copy[locale];
    const path = legalPath(locale, e);
    const lhead = contentHead(SEO_BASE_URL, {
      locale,
      path,
      title: copy.title,
      description: copy.description,
      alternates: LOCALES.map((l) => ({ locale: l, path: legalPath(l, e) })),
      jsonLd: legalJsonLd(copy),
      mdPath: `${path}index.md`,
    });
    emitPage(
      path,
      contentShell(locale, lhead, renderLegal(copy, hub, hubPath(locale), legalPath(other, e), nav)),
      legalMarkdown(SEO_BASE_URL, { mdUrl: mdUrl(path), htmlUrl: SEO_BASE_URL + path }, copy, hubPath(locale)),
    );
  }
}
writeFileSync(join(dist, 'llms.txt'), llmsTxt(SEO_BASE_URL, llmsHubs, llmsGuides));

// Self-verify: read back and prove the artifacts match the manifest.
const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
assert.ok(robots.includes('Allow: /'), 'robots allows crawling');
assert.ok(robots.includes(`Sitemap: ${SEO_BASE_URL}/sitemap.xml`), 'robots declares sitemap');
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'sitemap xml prolog');
assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap urlset');
for (const page of SEO_PAGES) {
  assert.ok(sitemap.includes(`<loc>${SEO_BASE_URL}${page.path}</loc>`), `sitemap lists ${page.path}`);
}
const readLd = (html, label) => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, `${label} has JSON-LD`);
  return JSON.parse(m[1]);
};
const readPage = (path) => readFileSync(join(dist, ...path.split('/').filter(Boolean), 'index.html'), 'utf8');
for (const locale of LOCALES) {
  const html = readPage(hubPath(locale));
  assert.ok(html.includes(`<link rel="canonical" href="${SEO_BASE_URL}${hubPath(locale)}" />`), `${locale} canonical`);
  for (const l of LOCALES) {
    assert.ok(html.includes(`hreflang="${l}" href="${SEO_BASE_URL}${hubPath(l)}"`), `${locale} hreflang ${l}`);
  }
  assert.ok(html.includes(`hreflang="x-default" href="${SEO_BASE_URL}/"`), `${locale} x-default`);
  assert.ok(!html.includes('<script src'), `${locale} has no app JS`);
  assert.ok(!html.includes('type="module"'), `${locale} has no modules`);
  const data = readLd(html, locale);
  assert.ok(Array.isArray(data), `${locale} json-ld graph`);
  const [soft, faq] = data;
  assert.equal(soft['@type'], 'SoftwareApplication');
  assert.equal(soft.url, `${SEO_BASE_URL}${hubPath(locale)}`);
  assert.equal(faq['@type'], 'FAQPage');
  assert.equal(faq.mainEntity.length, HUB[locale].faqs.length);
  for (const g of GUIDES) {
    assert.ok(html.includes(`href="${guidePath(locale, g)}"`), `${locale} links ${g.slug[locale]}`);
  }
  const nav = footerNav(locale);
  assert.ok(html.includes(`href="${nav.privacyPath}"`), `${locale} links privacy`);
  assert.ok(html.includes(`href="${nav.termsPath}"`), `${locale} links terms`);
}
for (const g of GUIDES) {
  for (const locale of LOCALES) {
    const path = guidePath(locale, g);
    const html = readPage(path);
    assert.ok(html.includes(`<link rel="canonical" href="${SEO_BASE_URL}${path}" />`), `${path} canonical`);
    for (const l of LOCALES) {
      assert.ok(
        html.includes(`hreflang="${l}" href="${SEO_BASE_URL}${guidePath(l, g)}"`),
        `${path} hreflang ${l}`,
      );
    }
    const data = readLd(html, path);
    assert.equal(data['@type'], 'HowTo');
    assert.equal(data.step.length, g.copy[locale].steps.length);
  }
}
for (const e of LEGAL) {
  for (const locale of LOCALES) {
    const path = legalPath(locale, e);
    const html = readPage(path);
    assert.ok(html.includes(`<link rel="canonical" href="${SEO_BASE_URL}${path}" />`), `${path} canonical`);
    for (const l of LOCALES) {
      assert.ok(
        html.includes(`hreflang="${l}" href="${SEO_BASE_URL}${legalPath(l, e)}"`),
        `${path} hreflang ${l}`,
      );
    }
    assert.ok(html.includes(`hreflang="x-default" href="${SEO_BASE_URL}/"`), `${path} x-default`);
    assert.ok(!html.includes('<script src'), `${path} has no app JS`);
    const data = readLd(html, path);
    assert.equal(data['@type'], 'WebPage');
    assert.equal(data.name, e.copy[locale].h1);
  }
}
const llms = readFileSync(join(dist, 'llms.txt'), 'utf8');
assert.ok(llms.startsWith('# velohud\n'), 'llms H1 first');
for (const entry of [...llmsHubs, ...llmsGuides]) {
  assert.ok(llms.includes(entry.mdUrl), `llms links ${entry.mdUrl}`);
}
console.log(
  `seo-build ok: robots.txt + sitemap.xml (${SEO_PAGES.length} urls) + hubs + ${GUIDES.length * 2} guides + ${LEGAL.length * 2} legal + llms.txt -> web/dist`,
);
