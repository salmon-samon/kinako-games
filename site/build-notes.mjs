// notes.md → notes.html の事前変換（2026-11-18）。
// 表示時に fetch する方式は、環境によって .md が変換済みHTMLで返ってきて表示が壊れたので廃止。
// 使い方: node build-notes.mjs （notes.md を編集したら実行して、notes.html ごとコミットする）
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mdToHtml } = require('./md.js');

const md = readFileSync(new URL('./notes.md', import.meta.url), 'utf8');
const html = mdToHtml(md);
const pagePath = new URL('./notes.html', import.meta.url);
const page = readFileSync(pagePath, 'utf8');
const re = /(<!--MD-START-->)[\s\S]*?(<!--MD-END-->)/;
if (!re.test(page)) {
  console.error('notes.html に MD-START/MD-END マーカーが見つからない');
  process.exit(1);
}
writeFileSync(pagePath, page.replace(re, '$1\n' + html + '\n$2'));
console.log('notes.html を再生成した');
