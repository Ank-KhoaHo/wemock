// The documentation site, built from the guide's own pages: `npm run docs:build` writes it to
// guide/.vitepress/dist, and .github/workflows/docs.yml publishes it after each release.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const STORE = 'https://chromewebstore.google.com/detail/wemock/meoiipgffocfcgafaakjkodmfmmfoggk';
const REPO = 'https://github.com/Ank-KhoaHo/wemock';

// The guide's order is written once, in the table of guide/README.md, which is also what GitHub
// shows for the folder. Each row starts with a link to its page.
const table = readFileSync(new URL('../README.md', import.meta.url), 'utf-8');
const pages = [...table.matchAll(/^\| \[([^\]]+)\]\(([\w-]+)\.md\) \|/gm)].map(([, text, file]) => ({
  text: text!,
  link: `/${file!}`,
}));
if (pages.length === 0) throw new Error('No page was read from the table in guide/README.md');

export default defineConfig({
  title: 'wemock',
  description: 'Record real API calls in Chrome DevTools, then replay them as switchable mock scenarios.',
  lang: 'en',
  base: '/wemock/',
  cleanUrls: true,
  // GitHub opens README.md for the folder; on the site the same page is the guide's index, /guide.
  // The pages link to README.md, which is right on GitHub. VitePress counts a link to a page it
  // renamed as dead, so on the site each such link is pointed at the new name before it is read.
  rewrites: { 'README.md': 'guide.md' },
  markdown: {
    config(md) {
      md.core.ruler.push('guide-index-links', (state) => {
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            const href = token.type === 'link_open' ? token.attrGet('href') : null;
            if (href) token.attrSet('href', href.replace(/^(\.\/)?README\.md(?=$|#)/, 'guide.md'));
          }
        }
      });
      // A page is a Vue template, so `{{` in text or in a code span would run as code; the guide
      // writes `{{params.id}}` and "Fill {{templates}}" for the reader. Code blocks are kept as text.
      for (const rule of ['text', 'code_inline'] as const) {
        const render = md.renderer.rules[rule]!;
        md.renderer.rules[rule] = (...args) => render(...args).replace(/\{\{/g, '&#123;&#123;');
      }
    },
  },
  sitemap: { hostname: 'https://ank-khoaho.github.io/wemock/' },
  head: [['link', { rel: 'icon', type: 'image/png', href: '/wemock/32.png' }]],
  // The extension's own icons, so the site has one copy of each, not two.
  vite: { publicDir: fileURLToPath(new URL('../../public/icon', import.meta.url)) },
  themeConfig: {
    logo: '/48.png',
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'Changelog', link: '/changelog' },
      { text: 'Chrome Web Store', link: STORE },
    ],
    sidebar: [
      { text: 'Guide', link: '/guide', items: pages },
      { text: 'Changelog', link: '/changelog' },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: REPO }],
    footer: {
      message:
        'wemock is maintained by <a href="https://wanksolution.com/">WillowAnk Solution</a>. ' +
        'Product page: <a href="https://wanksolution.com/wemock/">wanksolution.com/wemock</a>.',
      copyright: 'MIT licence',
    },
  },
});
