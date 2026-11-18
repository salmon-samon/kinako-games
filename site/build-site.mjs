// サイトの共通部分を site.config.mjs から全ページに配る（v1.0.0で導入）。
// 配るもの: タブバー（今いるページに active + aria-current）、フッターのバージョン、
//           <title>、meta description、favicon。
// 使い方: node build-site.mjs
//   - ページの本文は触らない。共通部分だけを置き換えるので何度実行しても同じ結果になる。
//   - notes.html の本文（MD生成部分）にも触らない。build-notes.mjs と併用できる。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { VERSION, SITE_NAME, PAGES } from './site.config.mjs';

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M50 6C58 26 80 48 80 67a30 30 0 1 1-60 0C20 48 42 26 50 6Z' fill='%237fd4ff'/%3E%3C/svg%3E";

function tabbar(currentFile) {
  const tabs = PAGES.map(p => {
    const active = p.file === currentFile;
    return `      <a class="tab${active ? ' active' : ''}" href="${p.file}"${active ? ' aria-current="page"' : ''}>${p.label}</a>`;
  }).join('\n');
  return `<header class="tabbar">
    <div class="brand">${SITE_NAME}</div>
    <nav class="tabs" aria-label="ページ">
${tabs}
    </nav>
  </header>`;
}

let failed = 0;
for (const page of PAGES) {
  const path = new URL('./' + page.file, import.meta.url);
  let html;
  try {
    html = readFileSync(path, 'utf8');
  } catch {
    console.error(`NG: ${page.file} が無い（site.config.mjs の PAGES と実ファイルがズレてる）`);
    failed++;
    continue;
  }
  const before = html;

  if (!/<header class="tabbar">[\s\S]*?<\/header>/.test(html)) { console.error(`NG: ${page.file} に tabbar が無い`); failed++; continue; }
  html = html.replace(/<header class="tabbar">[\s\S]*?<\/header>/, tabbar(page.file));

  if (!/<footer>[\s\S]*?<\/footer>/.test(html)) { console.error(`NG: ${page.file} に footer が無い`); failed++; continue; }
  html = html.replace(/<footer>[\s\S]*?<\/footer>/, `<footer>${SITE_NAME} v${VERSION}</footer>`);

  if (!/<title>[\s\S]*?<\/title>/.test(html)) { console.error(`NG: ${page.file} に title が無い`); failed++; continue; }
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${page.title}</title>`);

  // meta description: あれば差し替え、無ければ viewport の直後に入れる
  if (/<meta name="description"[^>]*>/.test(html)) {
    html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${page.desc}">`);
  } else {
    html = html.replace(/(<meta name="viewport"[^>]*>\n)/, `$1<meta name="description" content="${page.desc}">\n`);
  }

  // favicon: 無ければ style.css の読み込み直後に入れる
  if (!/rel="icon"/.test(html)) {
    html = html.replace(/(<link rel="stylesheet" href="style\.css">\n)/, `$1<link rel="icon" href="${FAVICON}">\n`);
  }

  if (html !== before) {
    writeFileSync(path, html);
    console.log(`更新: ${page.file}`);
  } else {
    console.log(`変更なし: ${page.file}`);
  }
}

// PAGES に載ってない .html があったら警告（タブに出ないページができてしまうので）
const known = new Set(PAGES.map(p => p.file));
for (const f of readdirSync(new URL('.', import.meta.url))) {
  if (f.endsWith('.html') && !known.has(f)) {
    console.error(`警告: ${f} は site.config.mjs の PAGES に載っていない`);
    failed++;
  }
}

if (failed) { console.error(`build-site: ${failed} 件の問題`); process.exit(1); }
console.log(`build-site: v${VERSION} を ${PAGES.length} ページに配った`);
