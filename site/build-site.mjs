// サイトの共通部分を site.config.mjs から全ページに配る（v1.0.0で導入）。
// 配るもの: タブバー（今いるページに active + aria-current）、フッターのバージョン、
//           <title>、meta description、favicon。
// 使い方: node build-site.mjs
//   - ページの本文は触らない。共通部分だけを置き換えるので何度実行しても同じ結果になる。
//   - notes.html の本文（MD生成部分）にも触らない。build-notes.mjs と併用できる。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { VERSION, SITE_NAME, PAGES, ENABLED_PACKS, PACK_PAGES } from './site.config.mjs';

// 拡張パック（v1.1.0）: 有効なパックのページだけがタブに出る
const ACTIVE_PACK_PAGES = (PACK_PAGES || []).filter(p => (ENABLED_PACKS || []).includes(p.pack));
const HAS_NEW_TAB = ACTIVE_PACK_PAGES.some(p => p.providesNewTab);
const PACK_CSS_LINE = '<link rel="stylesheet" href="packs/terminal/new-tab.css">';
const PACK_SCRIPT_LINE = '<script src="packs/terminal/new-tab.js"></script>';

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M50 6C58 26 80 48 80 67a30 30 0 1 1-60 0C20 48 42 26 50 6Z' fill='%237fd4ff'/%3E%3C/svg%3E";

function tabbar(currentFile, base) {
  // base: 本体ページは ''、パック内ページ（packs/<id>/）は '../../'
  const prefix = base || '';
  const core = PAGES.map(p => {
    const active = p.file === currentFile;
    return `      <a class="tab${active ? ' active' : ''}" href="${prefix}${p.file}"${active ? ' aria-current="page"' : ''}>${p.label}</a>`;
  });
  const pack = ACTIVE_PACK_PAGES.map(p => {
    const active = p.file === currentFile;
    // パック内ページから見た自パックのタブはファイル名だけ、本体からはフルパス
    const href = prefix ? p.file.split('/').pop() : p.file;
    return `      <a class="tab${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>${p.label}</a>`;
  });
  const tabs = core.concat(pack).join('\n');
  const btn = HAS_NEW_TAB ? '\n      <button class="new-tab-btn" id="pack-new-tab-btn" type="button" aria-haspopup="dialog">＋ 新規タブ</button>' : '';
  return `<header class="tabbar">
    <div class="brand">${SITE_NAME}</div>
    <nav class="tabs" aria-label="ページ">
${tabs}${btn}
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

  // 拡張パックの CSS/JS: まず既存の配布分を剥がしてから、有効なときだけ配り直す
  html = html.replace(/<link rel="stylesheet" href="packs\/terminal\/new-tab\.css">\n/g, '');
  html = html.replace(/<script src="packs\/terminal\/new-tab\.js"><\/script>\n/g, '');
  if (HAS_NEW_TAB) {
    html = html.replace(/(<link rel="stylesheet" href="style\.css">\n)/, `$1${PACK_CSS_LINE}\n`);
    html = html.replace(/<\/body>/, `${PACK_SCRIPT_LINE}\n</body>`);
  }

  if (html !== before) {
    writeFileSync(path, html);
    console.log(`更新: ${page.file}`);
  } else {
    console.log(`変更なし: ${page.file}`);
  }
}

// 拡張パックのページ（有効なものだけ）: タブバー（相対パスは ../../ 起点）と
// フッターと title を本体と同じ「正」に揃える。本文とパック固有の CSS/JS は触らない。
for (const page of ACTIVE_PACK_PAGES) {
  const path = new URL('./' + page.file, import.meta.url);
  let html;
  try {
    html = readFileSync(path, 'utf8');
  } catch {
    console.error(`NG: パックページ ${page.file} が無い`);
    failed++;
    continue;
  }
  const before = html;
  if (!/<header class="tabbar">[\s\S]*?<\/header>/.test(html)) { console.error(`NG: ${page.file} に tabbar が無い`); failed++; continue; }
  html = html.replace(/<header class="tabbar">[\s\S]*?<\/header>/, tabbar(page.file, '../../'));
  if (/<footer>[\s\S]*?<\/footer>/.test(html)) {
    html = html.replace(/<footer>[\s\S]*?<\/footer>/, `<footer>${SITE_NAME} v${VERSION}</footer>`);
  }
  if (/<title>[\s\S]*?<\/title>/.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${page.title}</title>`);
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
console.log(`build-site: v${VERSION} を ${PAGES.length + ACTIVE_PACK_PAGES.length} ページに配った（パック: ${ACTIVE_PACK_PAGES.map(p => p.pack).join(', ') || 'なし'}）`);
