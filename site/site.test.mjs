// サイト本体のテスト。実行: node site.test.mjs（全部通れば SITE_TEST_ALL_OK と出す）
// 「正」は site.config.mjs。build-site.mjs が配った共通部分が各ページに
// 正しく入っているか、リンクが実ファイルに届くかをここで確かめる。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { VERSION, SITE_NAME, PAGES, ENABLED_PACKS, PACK_PAGES } from './site.config.mjs';

const ACTIVE_PACK_PAGES = (PACK_PAGES || []).filter(p => (ENABLED_PACKS || []).includes(p.pack));
const HAS_NEW_TAB = ACTIVE_PACK_PAGES.some(p => p.providesNewTab);
const EXPECTED_TABS = PAGES.length + ACTIVE_PACK_PAGES.length;

const siteDir = fileURLToPath(new URL('.', import.meta.url));

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('FAIL:', name);
  if (detail !== undefined) console.error('  ', detail);
}

// タグ文字列から属性値を取る（属性の並び順に依存しない）
function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"'));
  return m ? m[1] : null;
}
function hasClass(tag, cls) {
  const c = attr(tag, 'class');
  return c !== null && c.split(/\s+/).includes(cls);
}

// ===== 1〜6: ページごとのチェック =====
for (const page of PAGES) {
  const path = resolve(siteDir, page.file);

  // 1. ファイルが存在する
  check(`存在: ${page.file}`, existsSync(path));
  if (!existsSync(path)) continue;
  const html = readFileSync(path, 'utf8');

  // 2. active なタブがちょうど1つで、自ページを指し、aria-current="page" を持つ
  const anchors = html.match(/<a\b[^>]*>/g) || [];
  const tabs = anchors.filter(t => hasClass(t, 'tab'));
  const actives = tabs.filter(t => hasClass(t, 'active'));
  check(`タブ総数: ${page.file}`, tabs.length === EXPECTED_TABS, `tabs=${tabs.length} expected=${EXPECTED_TABS}`);
  // 拡張パック: 有効なときだけ新規タブボタンとパックの CSS/JS が入る。無効なら痕跡なし
  if (HAS_NEW_TAB) {
    check(`新規タブボタン: ${page.file}`, html.includes('id="pack-new-tab-btn"'));
    check(`パックCSS: ${page.file}`, html.includes('href="packs/terminal/new-tab.css"'));
    check(`パックJS: ${page.file}`, html.includes('src="packs/terminal/new-tab.js"'));
  } else {
    check(`パック痕跡なし: ${page.file}`, !html.includes('pack-new-tab-btn') && !html.includes('packs/terminal/'));
  }
  check(`activeタブは1つ: ${page.file}`, actives.length === 1, `actives=${actives.length}`);
  if (actives.length === 1) {
    check(`activeタブのhref: ${page.file}`, attr(actives[0], 'href') === page.file, `href=${attr(actives[0], 'href')}`);
    check(`activeタブのaria-current: ${page.file}`, attr(actives[0], 'aria-current') === 'page', `aria-current=${attr(actives[0], 'aria-current')}`);
  }
  // active でないタブに aria-current が付いていないことも見る
  const stray = tabs.filter(t => !hasClass(t, 'active') && attr(t, 'aria-current') !== null);
  check(`非activeタブにaria-current無し: ${page.file}`, stray.length === 0, `stray=${stray.length}`);

  // 3. フッターが config の VERSION と一致する
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/);
  check(`フッター: ${page.file}`, !!footer && footer[1].trim() === `${SITE_NAME} v${VERSION}`,
    footer ? `footer=${JSON.stringify(footer[1].trim())} expected=${JSON.stringify(`${SITE_NAME} v${VERSION}`)}` : 'footerタグ無し');

  // 4. <title> が config と一致し、meta description がある
  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  check(`title: ${page.file}`, !!title && title[1].trim() === page.title,
    title ? `title=${JSON.stringify(title[1].trim())} expected=${JSON.stringify(page.title)}` : 'titleタグ無し');
  const metas = html.match(/<meta\b[^>]*>/g) || [];
  const descTag = metas.find(t => attr(t, 'name') === 'description');
  check(`meta description有無: ${page.file}`, !!descTag && !!attr(descTag || '', 'content'),
    descTag ? 'contentが空' : 'meta description無し');
  if (descTag) {
    check(`meta description内容: ${page.file}`, attr(descTag, 'content') === page.desc,
      `content=${JSON.stringify(attr(descTag, 'content'))} expected=${JSON.stringify(page.desc)}`);
  }

  // 5. インライン style 属性が無い
  //    ただし notes.html の MD生成領域（MD-START〜MD-END）は md.js が表の寄せ指定で
  //    style を出し得るので対象外にする（本体の手書き部分だけを見る）
  const handwritten = html.replace(/<!--MD-START-->[\s\S]*?<!--MD-END-->/, '');
  check(`インラインstyle無し: ${page.file}`, !handwritten.includes('style="'));

  // 6. 相対 href / src が実ファイルに解決できる
  const refs = [];
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) refs.push(m[1]);
  for (const ref of refs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue; // http: https: data: mailto: など
    if (ref.startsWith('#') || ref.startsWith('//')) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch { /* そのまま使う */ }
    const target = resolve(siteDir, dirname(page.file), decoded);
    check(`リンク解決: ${page.file} -> ${ref}`, existsSync(target), `target=${target}`);
  }
}

// ===== 7: style.css の必須要素 =====
const css = readFileSync(resolve(siteDir, 'style.css'), 'utf8');
check('css: :root がある', /:root\s*\{/.test(css));
check('css: CSS変数の定義がある', /--[a-z][a-z0-9-]*\s*:/.test(css));
check('css: CSS変数が使われている', /var\(--[a-z][a-z0-9-]*\)/.test(css));
check('css: :focus-visible がある', css.includes(':focus-visible'));
check('css: prefers-reduced-motion がある', css.includes('prefers-reduced-motion'));

// ===== 8: glass.js の構文チェック＋スタブでの動作確認 =====
const glassPath = resolve(siteDir, 'glass.js');
try {
  execFileSync(process.execPath, ['--check', glassPath], { stdio: 'pipe' });
  check('glass.js: 構文チェック (node --check)', true);
} catch (e) {
  check('glass.js: 構文チェック (node --check)', false, String(e.stderr || e.message));
}

// DOM と localStorage の最小スタブで glass.js を実際に動かす
function makeEl(id) {
  const classes = new Set();
  return {
    id,
    textContent: '',
    style: {},
    children: [],
    className: '',
    _listeners: {},
    classList: {
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains(c) { return classes.has(c); },
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
    },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of this._listeners[type] || []) fn(ev); },
    appendChild(child) { this.children.push(child); },
    remove() {},
  };
}
try {
  const ids = ['cup', 'water', 'count', 'total', 'tiermsg', 'cupmsg', 'dropbtn', 'drinkbtn'];
  const els = Object.fromEntries(ids.map(id => [id, makeEl(id)]));
  const store = new Map();
  const sandbox = {
    document: {
      getElementById: id => els[id] || null,
      createElement: () => makeEl(''),
      body: makeEl('body'),
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    setTimeout: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(glassPath, 'utf8'), sandbox, { filename: 'glass.js' });

  check('glass: 初期表示は0滴', String(els.count.textContent) === '0', `count=${els.count.textContent}`);
  check('glass: 最初は drinkbtn が hidden', els.drinkbtn.classList.contains('hidden') === true);
  check('glass: 最初は dropbtn が見える', els.dropbtn.classList.contains('hidden') === false);

  els.dropbtn.fire('click');
  check('glass: クリックで1滴増える', String(els.count.textContent) === '1', `count=${els.count.textContent}`);

  els.cup.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('glass: Enterキーでも増える', String(els.count.textContent) === '2', `count=${els.count.textContent}`);

  for (let i = 0; i < 28; i++) els.dropbtn.fire('click');
  check('glass: 30滴で満杯', String(els.count.textContent) === '30', `count=${els.count.textContent}`);
  check('glass: 累計も30滴', String(els.total.textContent) === '30', `total=${els.total.textContent}`);
  check('glass: 満杯で「いっぱい！」', els.cupmsg.textContent === 'いっぱい！', `msg=${els.cupmsg.textContent}`);
  check('glass: 満杯で drinkbtn の hidden が外れる', els.drinkbtn.classList.contains('hidden') === false);
  check('glass: 満杯で dropbtn が hidden になる', els.dropbtn.classList.contains('hidden') === true);
  check('glass: localStorage に保存される', store.get('kinako-drops') === '30', `kinako-drops=${store.get('kinako-drops')}`);

  els.drinkbtn.fire('click');
  check('glass: のみほすと0に戻る', String(els.count.textContent) === '0', `count=${els.count.textContent}`);
  check('glass: のみほしても累計は減らない', String(els.total.textContent) === '30', `total=${els.total.textContent}`);
} catch (e) {
  check('glass.js: スタブ動作確認', false, String(e && e.stack || e));
}

// ===== 9: 拡張パック「ターミナル」 =====
const packDir = resolve(siteDir, 'packs/terminal');
try {
  const manifest = JSON.parse(readFileSync(resolve(packDir, 'pack.json'), 'utf8'));
  check('pack: manifest の id', manifest.id === 'terminal');
  check('pack: manifest が新規タブを提供', !!(manifest.provides && manifest.provides.newTabButton));
} catch (e) {
  check('pack: pack.json が読める', false, String(e && e.message || e));
}
for (const js of ['new-tab.js', 'terminal.js', 'viewer.js']) {
  try {
    execFileSync(process.execPath, ['--check', resolve(packDir, js)], { stdio: 'pipe' });
    check(`pack: ${js} 構文チェック`, true);
  } catch (e) {
    check(`pack: ${js} 構文チェック`, false, String(e.stderr || e.message));
  }
}
const termPath = resolve(packDir, 'terminal.html');
check('pack: terminal.html が存在', existsSync(termPath));
if (existsSync(termPath)) {
  const thtml = readFileSync(termPath, 'utf8');
  check('pack: terminal に入力欄がある', thtml.includes('id="term-in"') && thtml.includes('id="term-out"'));
  check('pack: terminal にインラインstyle無し', !thtml.includes('style="'));
  const tfooter = thtml.match(/<footer>([\s\S]*?)<\/footer>/);
  check('pack: terminal のフッター版数', !!tfooter && tfooter[1].trim() === `${SITE_NAME} v${VERSION}`);
  // パック無効時は terminal.html はサイトからリンクされない置物になるので、
  // タブまわりのチェックは有効なときだけ行う（無効時の痕跡なしは本体ページ側で確認済み）
  if (HAS_NEW_TAB) {
    const tanchors = thtml.match(/<a\b[^>]*>/g) || [];
    const ttabs = tanchors.filter(t => hasClass(t, 'tab'));
    check('pack: terminal のタブ総数', ttabs.length === EXPECTED_TABS, `tabs=${ttabs.length} expected=${EXPECTED_TABS}`);
    const tactives = ttabs.filter(t => hasClass(t, 'active'));
    check('pack: terminal の active は自分', tactives.length === 1 && attr(tactives[0], 'href') === 'terminal.html');
    check('pack: terminal にも新規タブボタン', thtml.includes('id="pack-new-tab-btn"'));
  }
}
// terminal.js をスタブで動かす: バナー / help / version / glass / 未知コマンド / open chess
try {
  function termEl(id) {
    const el = {
      id, textContent: '', value: '', children: [], scrollTop: 0, scrollHeight: 0,
      _listeners: {},
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
      fire(type, ev = {}) { for (const fn of this._listeners[type] || []) fn(ev); },
      appendChild(c) { this.children.push(c); },
      focus() {},
    };
    return el;
  }
  const tout = termEl('term-out');
  const tin = termEl('term-in');
  const trun = termEl('term-run');
  const tfooterEl = termEl('footer');
  tfooterEl.textContent = `${SITE_NAME} v${VERSION}`;
  const tstore = new Map([['kinako-drops', '7'], ['kinako-drops-total', '42']]);
  const tsandbox = {
    document: {
      getElementById: id => ({ 'term-out': tout, 'term-in': tin, 'term-run': trun })[id] || null,
      createElement: () => termEl(''),
      querySelector: sel => (sel === 'footer' ? tfooterEl : null),
    },
    localStorage: {
      getItem: k => (tstore.has(k) ? tstore.get(k) : null),
      setItem: (k, v) => tstore.set(k, String(v)),
    },
    location: {},
    setTimeout: () => 0,
  };
  vm.createContext(tsandbox);
  vm.runInContext(readFileSync(resolve(packDir, 'terminal.js'), 'utf8'), tsandbox, { filename: 'terminal.js' });
  const outText = () => tout.children.map(c => c.textContent).join('\n');
  check('terminal: バナーが出る', outText().includes('きなこのターミナル'), outText());
  tin.value = 'help'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: help が動く', outText().includes('使えるコマンド'));
  tin.value = 'version'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: version が版数を出す', outText().includes('v' + VERSION), outText());
  tin.value = 'glass'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: glass がしずくを出す', outText().includes('7 / 30') && outText().includes('42'), outText());
  tin.value = 'open chess'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: open chess は予定を案内', outText().includes('v1.2.0'), outText());
  tin.value = 'hogehoge'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: 未知コマンドの案内', outText().includes('コマンドが見つからない'));
} catch (e) {
  check('terminal.js: スタブ動作確認', false, String(e && e.stack || e));
}

// ===== サマリ =====
console.log(`site.test: ${passed + failed}件中 ${passed}件 OK / ${failed}件 FAIL`);
if (failed) { console.error(failed + '件失敗'); process.exit(1); }
console.log('SITE_TEST_ALL_OK');
