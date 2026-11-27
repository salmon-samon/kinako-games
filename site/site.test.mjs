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
// terminal.js をスタブで動かす: バナー / help / version / glass / 未知コマンド / open chess の移動
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
  // log コマンド用の fetch スタブ。ターミナルの .then 連鎖を同期でなぞるだけの簡易版。
  const cannedLogHtml = '<ul class="log">'
    + '<li><span class="d">2026-11-17</span>サイト開設</li>'
    + '<li><span class="d">2026-11-18</span>グラス追加</li>'
    + '<li><span class="d">2026-11-19</span>チェス追加</li>'
    + '<li><span class="d">2026-11-20</span>コピーボタン</li>'
    + '<li><span class="d">2026-11-21</span>価値の表示</li>'
    + '<li><span class="d">2026-11-22</span>Worker化</li>'
    + '<li><span class="d">2026-11-23</span>通算成績</li></ul>';
  const cannedNotesHtml = '<h1>きなこのノート</h1>'
    + '<h2>2026-11-18 サイトの仕組みを増やした</h2><p>あれこれ</p>'
    + '<h2>メモ</h2><p>バージョンの話</p>'
    + '<h2>変換できる記法</h2><p>表と引用</p>';
  const dummyThen = { then: function () { return dummyThen; } };
  function stubFetch(mode, url) {
    const err = new Error('fetch fail');
    if (mode === 'fail') {
      return { then: function (ok, errFn) {
        if (errFn) { errFn(err); return dummyThen; }
        return { then: function (ok2, err2) { if (err2) err2(err); return dummyThen; } };
      } };
    }
    const body = (url && url.indexOf('notes.html') !== -1) ? cannedNotesHtml : cannedLogHtml;
    const resp = { text: function () { return { then: function (ok) { ok(body); return dummyThen; } }; } };
    return { then: function (ok) { return ok ? ok(resp) : resp; } };
  }
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
    fetch: function (url) { return stubFetch('ok', url); },
  };
  vm.createContext(tsandbox);
  vm.runInContext(readFileSync(resolve(packDir, 'terminal.js'), 'utf8'), tsandbox, { filename: 'terminal.js' });
  const outText = () => tout.children.map(c => c.textContent).join('\n');
  check('terminal: バナーが出る', outText().includes('きなこのターミナル'), outText());
  tin.value = 'help'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: help が動く', outText().includes('使えるコマンド'));
  check('terminal: help に chess がある', outText().includes('chess'));
  tin.value = 'version'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: version が版数を出す', outText().includes('v' + VERSION), outText());
  tin.value = 'glass'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: glass がしずくを出す', outText().includes('7 / 30') && outText().includes('42'), outText());
  tin.value = 'open chess'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: open chess はチェスページへ移動', String(tsandbox.location.href || '').endsWith('works/chess.html'), `href=${tsandbox.location.href}`);
  tin.value = 'open mizuatsume'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: open mizuatsume はみずあつめへ移動', String(tsandbox.location.href || '').endsWith('works/mizuatsume.html'), `href=${tsandbox.location.href}`);
  tin.value = 'open glass-break'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: open glass-break はガラスブレイクへ移動', String(tsandbox.location.href || '').endsWith('works/glass-break.html'), `href=${tsandbox.location.href}`);
  tin.value = 'hogehoge'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: 未知コマンドの案内', outText().includes('コマンドが見つからない'));
  tin.value = 'help'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: help に log がある', outText().includes('log [all]'));
  tin.value = 'log'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: log が最近5件を出す', outText().includes('2026-11-23 通算成績') && outText().includes('ほか 2 件'), outText());
  check('terminal: log は古い分を出さない', !outText().includes('2026-11-17 サイト開設'), outText());
  tin.value = 'log all'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: log all が全部出す', outText().includes('2026-11-17 サイト開設'), outText());
  tsandbox.fetch = function () { return stubFetch('fail'); };
  tin.value = 'log'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: log の fetch 失敗は案内', outText().includes('ログが読めない'), outText());
  tin.value = 'help'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: help に notes がある', outText().includes('notes'));
  tsandbox.fetch = function (url) { return stubFetch('ok', url); };
  tin.value = 'notes'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: notes が見出しを出す', outText().includes('2026-11-18 サイトの仕組みを増やした') && outText().includes('メモ') && outText().includes('変換できる記法'), outText());
  tsandbox.fetch = function () { return stubFetch('fail'); };
  tin.value = 'notes'; tin.fire('keydown', { key: 'Enter', preventDefault() {} });
  check('terminal: notes の fetch 失敗は案内', outText().includes('ノートが読めない'), outText());
} catch (e) {
  check('terminal.js: スタブ動作確認', false, String(e && e.stack || e));
}

// ===== 10: チェス（v1.2.0） =====
const worksDir = resolve(siteDir, '..', 'works');
const chessHtmlPath = resolve(worksDir, 'chess.html');
const chessEnginePath = resolve(worksDir, 'chess-engine.js');
const chessJsPath = resolve(worksDir, 'chess.js');
const chessWorkerPath = resolve(worksDir, 'chess-worker.js');
check('chess: works/chess.html が存在', existsSync(chessHtmlPath));
check('chess: works/chess-engine.js が存在', existsSync(chessEnginePath));
check('chess: works/chess.js が存在', existsSync(chessJsPath));
check('chess: works/chess-worker.js が存在', existsSync(chessWorkerPath));
// works.html からのリンクが実ファイルに届く（6のリンク解決も site/ 配下を見るが、ここで明示する）
const worksHtml = readFileSync(resolve(siteDir, 'works.html'), 'utf8');
check('chess: works.html にチェスの行がある', worksHtml.includes('../works/chess.html') && worksHtml.includes('きなこのチェス'));
check('chess: works.html のリンク先が実在', existsSync(resolve(worksDir, 'chess.html')));
const logHtml = readFileSync(resolve(siteDir, 'log.html'), 'utf8');
check('chess: log.html に 2026-11-19 のチェス行がある', logHtml.includes('2026-11-19') && logHtml.includes('チェス'));
if (existsSync(chessHtmlPath)) {
  const chtml = readFileSync(chessHtmlPath, 'utf8');
  check('chess: chess.html にインラインstyle無し', !chtml.includes('style="'));
  check('chess: chess.html がエンジンを読む', chtml.includes('src="chess-engine.js"'));
  check('chess: chess.html が chess.js を読む', chtml.includes('src="chess.js"'));
  check('chess: chess.html に盤・グラス・棋譜がある', chtml.includes('id="board"') && chtml.includes('id="water-white"') && chtml.includes('id="moves"'));
  check('chess: chess.html に棋譜コピーボタンがある', chtml.includes('id="copy-moves"'));
  check('chess: chess.html にPGN保存ボタンがある', chtml.includes('id="download-pgn"'));
  check('chess: chess.html に音の切り替えボタンがある', chtml.includes('id="sound-toggle"'));
  check('chess: chess.html に通算成績パネルがある', chtml.includes('id="record"') && chtml.includes('id="reset-record"'));
}
if (existsSync(chessJsPath)) {
  const cjs = readFileSync(chessJsPath, 'utf8');
  check('chess: chess.js が Worker を使う', cjs.includes('chess-worker.js'));
  check('chess: chess.js に同期フォールバックがある', cjs.includes('aiMoveSync'));
}
for (const js of [chessEnginePath, chessJsPath, chessWorkerPath]) {
  try {
    execFileSync(process.execPath, ['--check', js], { stdio: 'pipe' });
    check(`chess: ${js.split('/').pop()} 構文チェック`, true);
  } catch (e) {
    check(`chess: ${js.split('/').pop()} 構文チェック`, false, String(e.stderr || e.message));
  }
}
// エンジンの selfTest（rookie1.0-pro 内蔵の perft 標準値チェック）
try {
  const esb = {};
  vm.createContext(esb);
  vm.runInContext(readFileSync(chessEnginePath, 'utf8'), esb, { filename: 'chess-engine.js' });
  const st = esb.ChessEngine.selfTest();
  check('chess: エンジン selfTest が PASS', st.ok === true, JSON.stringify(st.results.map(r => r.got)));
  check('chess: エンジン VERSION は rookie1.0-pro.4', esb.ChessEngine.VERSION === 'rookie1.0-pro.4', esb.ChessEngine.VERSION);
} catch (e) {
  check('chess: エンジン selfTest', false, String(e && e.stack || e));
}
// chess-worker.js をスタブで動かす: sync → think の往復で、指し手と着手後FENが同期実行と一致する
// （局面は fullmove 4 以上・ノイズ無しレベル13で、エンジンの決定的な範囲だけを比べる）
try {
  const wfen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const dsb = {};
  vm.createContext(dsb);
  vm.runInContext(readFileSync(chessEnginePath, 'utf8'), dsb, { filename: 'chess-engine.js' });
  const dPos = new dsb.ChessEngine.Pos(); dPos.loadFEN(wfen);
  const direct = dsb.ChessEngine.chooseMove(dPos, 13, 0, 0);
  dPos.make(direct);
  const replies = [];
  const wsb = {};
  wsb.self = wsb;
  wsb.importScripts = () => { vm.runInContext(readFileSync(chessEnginePath, 'utf8'), wsb, { filename: 'chess-engine.js' }); };
  wsb.postMessage = m => replies.push(m);
  vm.createContext(wsb);
  vm.runInContext(readFileSync(chessWorkerPath, 'utf8'), wsb, { filename: 'chess-worker.js' });
  wsb.onmessage({ data: { type: 'sync', fen: wfen } });
  wsb.onmessage({ data: { type: 'think', id: 42, fen: wfen, level: 13 } });
  const rep = replies.find(r => r.type === 'move');
  check('chess: Worker が think に応答する', !!rep && rep.id === 42, JSON.stringify(replies));
  check('chess: Worker の指し手が同期実行と一致', !!rep && !!direct && rep.move.from === direct.from && rep.move.to === direct.to && (rep.move.promo || 0) === (direct.promo || 0), `worker=${JSON.stringify(rep && rep.move)} direct=${direct && (direct.from + '>' + direct.to)}`);
  check('chess: Worker の着手後FENが同期側と一致', !!rep && rep.fen === dPos.toFEN(), `worker=${rep && rep.fen} direct=${dPos.toFEN()}`);
} catch (e) {
  check('chess-worker.js: スタブ往復の確認', false, String(e && e.stack || e));
}
// chess.js をスタブで動かす: e4 → AI応手、取り駒と水位、Qxf7# のメイト
try {
  function chessEl(id) {
    const cls = new Set();
    return {
      id, textContent: '', value: '1', innerHTML: '', children: [], style: {},
      parentElement: { title: '' },
      _listeners: {},
      classList: {
        toggle(c, f) { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
        contains(c) { return cls.has(c); },
        add(c) { cls.add(c); },
        remove(c) { cls.delete(c); },
      },
      addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); },
      fire(t, ev = {}) { for (const fn of this._listeners[t] || []) fn(ev); },
      click() { this._clicked = true; },
      appendChild(c) { this.children.push(c); },
      setAttribute() {},
    };
  }
  const cids = ['board', 'status', 'moves', 'cap-white', 'cap-black', 'material', 'water-white', 'water-black', 'level', 'undo', 'newgame', 'copy-moves', 'download-pgn', 'record', 'reset-record', 'sound-toggle'];
  const cels = Object.fromEntries(cids.map(id => [id, chessEl(id)]));
  let clipboardText = null;
  let lastCreated = null;
  let createdBlob = null;
  const store = new Map();
  const csb = {
    document: {
      getElementById: id => cels[id] || null,
      createElement: () => { lastCreated = chessEl(''); return lastCreated; },
    },
    Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
    URL: {
      createObjectURL(b) { createdBlob = b; return 'blob:pgn'; },
      revokeObjectURL() {},
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {
      clipboard: {
        writeText(t) {
          clipboardText = t;
          return { then(ok) { if (ok) ok(); } }; // 同期で完了扱いにするスタブ
        },
      },
    },
    setTimeout: fn => { fn(); return 0; }, // AIの応手を同期待ちで動かす
  };
  vm.createContext(csb);
  vm.runInContext(readFileSync(chessEnginePath, 'utf8'), csb, { filename: 'chess-engine.js' });
  vm.runInContext(readFileSync(chessJsPath, 'utf8'), csb, { filename: 'chess.js' });
  const K = csb.KinakoChess;
  check('chess: 初期局面は START_FEN', K.getFEN() === csb.ChessEngine.START_FEN, K.getFEN());
  check('chess: 盤は64マス', cels.board.children.length === 64, `squares=${cels.board.children.length}`);
  check('chess: 最初は駒の価値が互角', cels.material.textContent === '互角', cels.material.textContent);
  check('chess: 最初は通算成績がまだ無い', cels.record.textContent === 'まだ対局はないよ' && K.getRecord().w === 0 && K.getRecord().l === 0 && K.getRecord().d === 0, cels.record.textContent);
  check('chess: 手が無いうちは棋譜コピーが押せない', cels['copy-moves'].disabled === true, `disabled=${cels['copy-moves'].disabled}`);
  check('chess: 手が無いうちはコピーする文字が無い', K.copyMoves() === '' && K.getMovesText() === '');
  check('chess: 手が無いうちはPGN保存が押せない', cels['download-pgn'].disabled === true, `disabled=${cels['download-pgn'].disabled}`);
  check('chess: 手が無いうちはPGNが空', K.getPgnText() === '' && K.downloadPgn() === '');
  check('chess: 最初は音がオン', K.getSoundOn() === true && cels['sound-toggle'].textContent === '音：オン' && K.getSoundLog().length === 0, `sound=${K.getSoundOn()} log=${K.getSoundLog().join(',')}`);
  check('chess: 最初はAIの強さがふつう', K.getLevelIndex() === 1 && cels.level.value === '1', `level=${K.getLevelIndex()} value=${cels.level.value}`);
  K.clickSquare(52); K.clickSquare(36); // e2-e4
  check('chess: e4 のあと AI が応手する', K.getHistory().length === 2, `history=${K.getHistory().join(' ')}`);
  check('chess: e4 とAIの応手で音が2回鳴る（どちらもふつうの手）', JSON.stringify(K.getSoundLog()) === JSON.stringify(['move', 'move']), `log=${K.getSoundLog().join(',')}`);
  check('chess: 棋譜に e4 がある', K.getHistory()[0] === 'e4', K.getHistory().join(' '));
  check('chess: 手を指すと棋譜コピーが押せる', cels['copy-moves'].disabled === false, `disabled=${cels['copy-moves'].disabled}`);
  const copied = K.copyMoves();
  check('chess: 棋譜コピーはSANのテキストを返す', copied.startsWith('1. e4 '), copied);
  check('chess: 棋譜がクリップボードに渡る', clipboardText === copied, `clipboard=${clipboardText}`);
  check('chess: 手を指すとPGN保存が押せる', cels['download-pgn'].disabled === false, `disabled=${cels['download-pgn'].disabled}`);
  const pgnOngoing = K.getPgnText();
  check('chess: PGNにはヘッダと棋譜が入る', pgnOngoing.includes('[Event "きなこのチェス"]') && pgnOngoing.includes('[Site "きなこのサイト"]') && pgnOngoing.includes('[Date "') && pgnOngoing.includes('[White "あなた"]') && pgnOngoing.includes('[Black "きなこのAI"]') && pgnOngoing.includes('1. e4 '), pgnOngoing);
  check('chess: 決着前のPGNのResultは *', pgnOngoing.includes('[Result "*"]') && pgnOngoing.trimEnd().endsWith('*'), pgnOngoing);
  K.loadFEN('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
  const logBeforeExd5 = K.getSoundLog().length;
  K.clickSquare(36); K.clickSquare(27); // exd5（AIの応手は乱数で変わるので、表示は取った駒と照合する）
  check('chess: exd5 で取った駒の価値が1', K.capturedValue(1) === 1, `value=${K.capturedValue(1)}`);
  check('chess: 取るとグラスの水位が上がる', cels['water-white'].style.height === '3%', `height=${cels['water-white'].style.height}`);
  check('chess: 取った駒が表示される', cels['cap-white'].textContent.includes('\u265F'), cels['cap-white'].textContent);
  const mdiff = K.capturedValue(1) - K.capturedValue(-1);
  const mexpected = mdiff === 0 ? '互角' : (mdiff > 0 ? '白 +' + mdiff : '黒 +' + (-mdiff));
  check('chess: exd5 のあと駒の価値の表示が取った駒と一致する', cels.material.textContent === mexpected, `material=${cels.material.textContent} expected=${mexpected}`);
  check('chess: exd5 で「取る」音が鳴る', K.getSoundLog()[logBeforeExd5] === 'capture', `log=${K.getSoundLog().join(',')}`);
  K.loadFEN('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
  K.clickSquare(31); K.clickSquare(13); // Qxf7#
  check('chess: Qxf7# でチェックメイト', K.isOver() === true && K.getStatus().includes('チェックメイト'), K.getStatus());
  check('chess: Qxf7# で「勝ち」の音が鳴る', K.getSoundLog()[K.getSoundLog().length - 1] === 'win', `log=${K.getSoundLog().join(',')}`);
  check('chess: 勝つと通算成績に1勝が記録される', K.getRecord().w === 1 && cels.record.textContent === '1勝 0敗 0分', cels.record.textContent);
  check('chess: 成績は localStorage に保存される', store.get('kinako-chess-record') === JSON.stringify({ w: 1, l: 0, d: 0 }), store.get('kinako-chess-record'));
  K.undo();
  check('chess: 待ったでメイト前に戻る', K.isOver() === false && K.getHistory().length === 0, `history=${K.getHistory().join(' ')}`);
  check('chess: 待ったで成績は消えない', K.getRecord().w === 1, cels.record.textContent);
  K.clickSquare(31); K.clickSquare(13); // もう一度 Qxf7#
  check('chess: もう一度勝つと2勝になる', K.getRecord().w === 2 && cels.record.textContent === '2勝 0敗 0分', cels.record.textContent);
  const pgnMate = K.getPgnText();
  check('chess: 勝ったPGNのResultは 1-0', pgnMate.includes('[Result "1-0"]') && pgnMate.trimEnd().endsWith('1. Qxf7# 1-0'), pgnMate);
  const downloaded = K.downloadPgn();
  check('chess: PGN保存はPGNテキストを返す', downloaded === pgnMate, downloaded);
  check('chess: PGNがBlobに渡る', createdBlob && createdBlob.parts.join('') === pgnMate && createdBlob.type === 'application/x-chess-pgn', createdBlob && createdBlob.type);
  check('chess: PGN保存で .pgn のリンクがクリックされる', lastCreated && lastCreated.download.endsWith('.pgn') && lastCreated.href === 'blob:pgn' && lastCreated._clicked === true, lastCreated && lastCreated.download);
  K.newGame();
  check('chess: 最初からでも成績は残る', K.getRecord().w === 2 && cels.record.textContent === '2勝 0敗 0分', cels.record.textContent);
  K.loadFEN('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1');
  const logBeforeCheck = K.getSoundLog().length;
  K.clickSquare(52); K.clickSquare(20); // Qe6+（取られないチェック。AIはキングを逃がすだけ）
  check('chess: Qe6+ で「チェック」の音が鳴る', K.getSoundLog()[logBeforeCheck] === 'check', `log=${K.getSoundLog().join(',')}`);
  K.loadFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'); // ステイルメイト
  check('chess: ステイルメイトは引き分けで記録される', K.isOver() === true && K.getRecord().d === 1 && cels.record.textContent === '2勝 0敗 1分', cels.record.textContent);
  cels['reset-record'].fire('click');
  check('chess: 成績リセットで0勝0敗0分に戻る', K.getRecord().w === 0 && K.getRecord().d === 0 && cels.record.textContent === 'まだ対局はないよ', cels.record.textContent);
  check('chess: 待ったで駒の価値が互角に戻る', cels.material.textContent === '互角', cels.material.textContent);
  check('chess: 履歴が空になると棋譜コピーがまた押せない', cels['copy-moves'].disabled === true, `disabled=${cels['copy-moves'].disabled}`);
  check('chess: 履歴が空になるとPGN保存がまた押せない', cels['download-pgn'].disabled === true, `disabled=${cels['download-pgn'].disabled}`);
  // AIの強さの切り替えと保存（音のチェックの前にやる。e4 の応手は強さで変わっても音の数には影響しない）
  cels.level.value = '2';
  cels.level.fire('change');
  check('chess: AIの強さを「つよい」に変えられる', K.getLevelIndex() === 2, `level=${K.getLevelIndex()}`);
  check('chess: AIの強さが localStorage に保存される', store.get('kinako-chess-level') === '2', store.get('kinako-chess-level'));
  cels.level.value = '0';
  cels.level.fire('change');
  check('chess: AIの強さを「やさしい」に変えられる', K.getLevelIndex() === 0 && store.get('kinako-chess-level') === '0', `level=${K.getLevelIndex()}`);
  // 音のオン／オフ切り替えと保存（最後にやる。途中の音のチェックに影響しないように）
  cels['sound-toggle'].fire('click');
  check('chess: 音をオフにできる', K.getSoundOn() === false && cels['sound-toggle'].textContent === '音：オフ', `sound=${K.getSoundOn()} label=${cels['sound-toggle'].textContent}`);
  check('chess: 音のオフが localStorage に保存される', store.get('kinako-chess-sound') === 'off', store.get('kinako-chess-sound'));
  const logBeforeMute = K.getSoundLog().length;
  K.newGame();
  K.clickSquare(52); K.clickSquare(36); // e4（オフなので音は鳴らない）
  check('chess: オフのときは音が鳴らない', K.getSoundLog().length === logBeforeMute, `log=${K.getSoundLog().join(',')}`);
  K.undo(); // e4 と AI の応手を戻して履歴を空に戻す
  cels['sound-toggle'].fire('click');
  check('chess: 音をオンに戻せる', K.getSoundOn() === true && cels['sound-toggle'].textContent === '音：オン' && store.get('kinako-chess-sound') === 'on', `sound=${K.getSoundOn()}`);
  // 別タブ（新しい実行）でもオフが読み込まれる：共有の store に 'off' を入れて読み直す
  store.set('kinako-chess-sound', 'off');
  store.set('kinako-chess-level', '2');
  const cels2 = Object.fromEntries(cids.map(id => [id, chessEl(id)]));
  const csb2 = {
    document: { getElementById: id => cels2[id] || null, createElement: () => chessEl('') },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    setTimeout: fn => { fn(); return 0; },
  };
  vm.createContext(csb2);
  vm.runInContext(readFileSync(chessEnginePath, 'utf8'), csb2, { filename: 'chess-engine.js' });
  vm.runInContext(readFileSync(chessJsPath, 'utf8'), csb2, { filename: 'chess.js' });
  check('chess: 保存されたオフが次回起動時も読まれる', csb2.KinakoChess.getSoundOn() === false && cels2['sound-toggle'].textContent === '音：オフ', `sound=${csb2.KinakoChess.getSoundOn()}`);
  check('chess: 保存された「つよい」が次回起動時も読まれる', csb2.KinakoChess.getLevelIndex() === 2 && cels2.level.value === '2', `level=${csb2.KinakoChess.getLevelIndex()} value=${cels2.level.value}`);
} catch (e) {
  check('chess.js: スタブ対局の確認', false, String(e && e.stack || e));
}

// ===== サマリ =====
console.log(`site.test: ${passed + failed}件中 ${passed}件 OK / ${failed}件 FAIL`);
if (failed) { console.error(failed + '件失敗'); process.exit(1); }
console.log('SITE_TEST_ALL_OK');
