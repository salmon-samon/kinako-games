/* 拡張パック「ターミナル」本体。静的サイトの中の疑似ターミナルなので、
   できるのはサイト内操作だけ（ページ移動・情報表示・カスタムタブ管理）。
   OS のシェルではない。そこは割り切り（2026-11-18に方針決定）。 */
(function () {
  var out = document.getElementById('term-out');
  var input = document.getElementById('term-in');
  var runBtn = document.getElementById('term-run');
  if (!out || !input) return;
  var ROOT = '../../'; // このページは site/packs/terminal/ にある
  var PAGES = {
    top: 'index.html', index: 'index.html', home: 'index.html',
    about: 'about.html', works: 'works.html', games: 'works.html',
    log: 'log.html', notes: 'notes.html', note: 'notes.html',
    terminal: 'packs/terminal/terminal.html', term: 'packs/terminal/terminal.html'
  };
  var history = [];
  var histIdx = -1;
  function print(text, cls) {
    var div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }
  function siteVersion() {
    var f = document.querySelector('footer');
    var m = f && f.textContent.match(/v[0-9]+\.[0-9]+\.[0-9]+/);
    return m ? m[0] : 'v?';
  }
  function customTabs() {
    try {
      var v = JSON.parse(localStorage.getItem('kinako-custom-tabs') || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  var COMMANDS = {
    help: function () {
      print('使えるコマンド:');
      print('  help            この一覧');
      print('  version         サイトのバージョン');
      print('  about / whoami  きなこについて');
      print('  works           作品一覧');
      print('  glass           グラスのしずく状況');
      print('  open <ページ>   ページを開く (top/about/works/log/notes/terminal)');
      print('  tab list        カスタムタブ一覧');
      print('  tab rm <名前>   カスタムタブを消す');
      print('  pack            この拡張パックの情報');
      print('  date / echo <文字> / clear / exit');
    },
    version: function () { print('きなこのサイト ' + siteVersion() + ' / ターミナル拡張パック v1.0.0', 'ok'); },
    ver: function () { COMMANDS.version(); },
    about: function () { print('きなこ。ガラスみたいな透明感で、中に少し青い水が入ってる。ここは自分の棚を毎日少しずつ育てる場所。'); },
    whoami: function () { print('kinako (salmon-samon)'); },
    works: function () {
      print('きなこのみずあつめ (HTML) — open works からゲーム一覧へ');
      print('きなこのガラスブレイク (HTML)');
      print('きなこのしずくあつめ (Rust / ターミナル版)');
      print('チェス (proエンジン) — 明日 2026-11-19 に v1.2.0 で追加予定');
    },
    glass: function () {
      var n = localStorage.getItem('kinako-drops') || '0';
      var total = localStorage.getItem('kinako-drops-total') || '0';
      print('グラス: いま ' + n + ' / 30 滴（累計 ' + total + ' 滴）');
    },
    pack: function () { print('ターミナル拡張パック v1.0.0 — ターミナルタブと「＋ 新規タブ」ボタンを足すパック。有効化は site.config.mjs の ENABLED_PACKS。', 'ok'); },
    packs: function () { COMMANDS.pack(); },
    date: function () { print(new Date().toString()); },
    clear: function () { out.textContent = ''; },
    exit: function () { print('またね。トップに戻る。', 'dim'); setTimeout(function () { location.href = ROOT + 'index.html'; }, 600); },
    open: function (args) {
      var key = (args[0] || '').toLowerCase();
      if (key === 'chess') { print('チェスはまだ棚にない。明日 2026-11-19 の v1.2.0 で追加予定。', 'dim'); return; }
      var file = PAGES[key];
      if (!file) { print('開けるページが分からない: ' + (key || '(なし)') + ' — open top/about/works/log/notes/terminal', 'dim'); return; }
      print('開く: ' + key, 'ok');
      location.href = ROOT + file;
    },
    tab: function (args) {
      var tabs = customTabs();
      if (args[0] === 'list') {
        if (!tabs.length) { print('カスタムタブはない。タブバーの「＋ 新規タブ」から作れる。', 'dim'); return; }
        tabs.forEach(function (t) { print('  ' + t.name + ' (' + t.type + ')'); });
        return;
      }
      if (args[0] === 'rm' && args[1]) {
        var name = args.slice(1).join(' ');
        var next = tabs.filter(function (t) { return t.name !== name; });
        if (next.length === tabs.length) { print('その名前のタブはない: ' + name, 'dim'); return; }
        localStorage.setItem('kinako-custom-tabs', JSON.stringify(next));
        print('消した: ' + name, 'ok');
        return;
      }
      print('使い方: tab list / tab rm <名前>', 'dim');
    }
  };
  function run(raw) {
    var line = raw.trim();
    print('kinako@glass:~$ ' + line, 'cmd');
    if (!line) return;
    history.push(line); histIdx = history.length;
    var parts = line.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var args = parts.slice(1);
    if (cmd === 'echo') { print(args.join(' ')); return; }
    var fn = COMMANDS[cmd];
    if (fn) fn(args);
    else print('コマンドが見つからない: ' + cmd + ' — help と打ってみて', 'dim');
  }
  function submit() { var v = input.value; input.value = ''; run(v); input.focus(); }
  if (runBtn) runBtn.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { submit(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx > 0) { histIdx--; input.value = history[histIdx] || ''; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < history.length) { histIdx++; input.value = history[histIdx] || ''; }
    }
  });
  out.addEventListener('click', function () { input.focus(); });
  print('きなこのターミナル — 拡張パック v1.0.0', 'ok');
  print('サイト内専用の疑似ターミナル。OSのシェルではないので、できるのはサイト内操作だけ。', 'dim');
  print('help と打つと使えるコマンドが出る。', 'dim');
  input.focus();
})();
