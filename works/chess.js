/* きなこのチェス — 対局ロジック（UI側）。
   エンジン本体は works/chess-engine.js（rookie1.0-pro、無変更）。
   ここは見た目の裏側だけ：白＝プレイヤー、黒＝AI。
   AIの思考は Web Worker（works/chess-worker.js）の中でエンジンに任せ、
   思考中も画面が固まらないようにする。Worker が使えない環境では従来どおり同期実行する。
   駒の値: P=1 N=3 B=3 R=5 Q=9（グラスの水位に使う）。 */
(function () {
  'use strict';
  var E = globalThis.ChessEngine;
  var $ = function (id) { return document.getElementById(id); };

  var GLYPHS = {
    1: '\u2659', 2: '\u2658', 3: '\u2657', 4: '\u2656', 5: '\u2655', 6: '\u2654',
    '-1': '\u265F', '-2': '\u265E', '-3': '\u265D', '-4': '\u265C', '-5': '\u265B', '-6': '\u265A'
  };
  var VALUES = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0 };
  var MAX_CAPTURE_VALUE = 39; // Q9+R5+R5+B3+B3+N3+N3+P1*8 = 39
  var LEVELS = [
    { name: 'やさしい', level: 2 },
    { name: 'ふつう', level: 9 },
    { name: 'つよい', level: 14 }
  ];
  var FILES = 'abcdefgh';

  var boardEl = $('board');
  var statusEl = $('status');
  var movesEl = $('moves');
  var capWhiteEl = $('cap-white');
  var capBlackEl = $('cap-black');
  var materialEl = $('material');
  var waterWhiteEl = $('water-white');
  var waterBlackEl = $('water-black');
  var levelEl = $('level');
  var undoBtn = $('undo');
  var newBtn = $('newgame');
  var copyBtn = $('copy-moves');

  if (!E) {
    if (statusEl) statusEl.textContent = 'エンジンが読み込めなかった。chess-engine.js を確認してね。';
    return;
  }

  var pos = new E.Pos();
  var history = []; // {m, san}
  var selected = -1;
  var legalHere = []; // 今の局面の合法手
  var thinking = false;
  var over = false;
  var lastMove = null;

  // AI思考用 Worker（思考中も画面・盤面操作が固まらないようにする）。
  // 使えない環境では従来どおりメインスレッドで同期実行する。
  var aiWorker = null;
  var aiWorkerBroken = false;
  var thinkId = 0; // 思考リクエストの照合 ID。局面を作り直すたびに進めて古い応答を捨てる

  function sqName(sq) { return FILES[sq & 7] + (8 - (sq >> 3)); }

  function legalFrom(sq) {
    return legalHere.filter(function (m) { return m.from === sq; });
  }

  function currentLevel() {
    var i = levelEl ? (parseInt(levelEl.value, 10) || 0) : 0;
    return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
  }

  // 取った駒の一覧とグラスの水位を更新する
  function capturedBy(color) { // color: 1=白が取った黒駒, -1=黒が取った白駒
    var list = [];
    for (var i = 0; i < history.length; i++) {
      var m = history[i].m;
      if (!m.cap) continue;
      var moverWhite = m.piece > 0;
      if ((color === 1 && moverWhite) || (color === -1 && !moverWhite)) list.push(m.cap);
    }
    return list;
  }
  function capturedValue(list) {
    var v = 0;
    for (var i = 0; i < list.length; i++) v += VALUES[Math.abs(list[i])] || 0;
    return v;
  }
  function renderCaptured() {
    var w = capturedBy(1); // 白が取った黒駒
    var b = capturedBy(-1); // 黒が取った白駒
    capWhiteEl.textContent = w.map(function (p) { return GLYPHS[p]; }).join(' ') || '—';
    capBlackEl.textContent = b.map(function (p) { return GLYPHS[p]; }).join(' ') || '—';
    var wv = capturedValue(w), bv = capturedValue(b);
    waterWhiteEl.style.height = Math.min(100, Math.round(wv / MAX_CAPTURE_VALUE * 100)) + '%';
    waterBlackEl.style.height = Math.min(100, Math.round(bv / MAX_CAPTURE_VALUE * 100)) + '%';
    waterWhiteEl.parentElement.title = '白が取った駒の価値: ' + wv;
    waterBlackEl.parentElement.title = '黒が取った駒の価値: ' + bv;
    if (materialEl) {
      var diff = wv - bv;
      materialEl.textContent = diff === 0 ? '互角' : (diff > 0 ? '白 +' + diff : '黒 +' + (-diff));
    }
  }

  // 棋譜を行の配列にする（表示とコピーの両方で使う）
  function movesLines() {
    var lines = [];
    for (var i = 0; i < history.length; i += 2) {
      var n = i / 2 + 1;
      var line = n + '. ' + history[i].san;
      if (history[i + 1]) line += ' ' + history[i + 1].san;
      lines.push(line);
    }
    return lines;
  }

  function renderMoves() {
    var lines = movesLines();
    movesEl.textContent = lines.length ? lines.join('\n') : 'まだ手はないよ。白からどうぞ。';
  }

  // 棋譜を1行ずつのテキストにして返す。手が無ければ空文字
  function movesText() {
    return movesLines().join('\n');
  }

  // 棋譜をクリップボードへコピーする。返り値はコピーしたテキスト（手が無ければ空文字）
  function copyMoves() {
    var text = movesText();
    if (!text) return '';
    var done = function () {
      copyBtn.textContent = 'コピーしたよ';
      setTimeout(function () { copyBtn.textContent = '棋譜をコピー'; }, 1500);
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        var p = navigator.clipboard.writeText(text);
        if (p && p.then) p.then(done, function () { fallbackCopy(text, done); });
        else done();
      } else {
        fallbackCopy(text, done);
      }
    } catch (e) {
      fallbackCopy(text, done);
    }
    return text;
  }

  // clipboard API が無い環境向けの代替手段（textarea 経由）
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      if (document.body) document.body.appendChild(ta);
      if (ta.select) ta.select();
      var ok = document.execCommand ? document.execCommand('copy') : false;
      if (ta.remove) ta.remove();
      if (ok && done) done();
    } catch (e) { /* コピーできなかったときは何もしない */ }
  }

  function renderBoard() {
    var squares = boardEl.children;
    var kingSq = -1;
    if (pos.inCheck()) {
      for (var s = 0; s < 64; s++) {
        if (pos.b[s] === pos.turn * 6) { kingSq = s; break; }
      }
    }
    var targets = {};
    if (selected >= 0) {
      var ms = legalFrom(selected);
      for (var i = 0; i < ms.length; i++) targets[ms[i].to] = ms[i];
    }
    for (var sq = 0; sq < 64; sq++) {
      var el = squares[sq];
      var p = pos.b[sq];
      el.textContent = p ? GLYPHS[p] : '';
      el.classList.toggle('light', ((sq >> 3) + (sq & 7)) % 2 === 0);
      el.classList.toggle('dark', ((sq >> 3) + (sq & 7)) % 2 === 1);
      el.classList.toggle('white-piece', p > 0);
      el.classList.toggle('black-piece', p < 0);
      el.classList.toggle('selected', sq === selected);
      el.classList.toggle('target', !!targets[sq]);
      el.classList.toggle('capture', !!(targets[sq] && targets[sq].cap));
      el.classList.toggle('lastmove', !!(lastMove && (sq === lastMove.from || sq === lastMove.to)));
      el.classList.toggle('check', sq === kingSq);
      el.setAttribute('aria-label', sqName(sq) + (p ? ' ' + GLYPHS[p] : ''));
    }
  }

  function endMessage() {
    // 返すのは null（続行）か、終わったときの文言
    if (pos.insufficient()) return '引き分け — 駒が足りないよ。';
    if (pos.isRepetition && pos.isRepetition()) return '引き分け — 同じ局面が3回出たよ。';
    if (typeof pos.half === 'number' && pos.half >= 100) return '引き分け — 50手ルール。';
    if (!pos.hasLegalMove()) {
      if (pos.inCheck()) return (pos.turn === 1 ? '黒の勝ち' : '白の勝ち') + ' — チェックメイト！';
      return '引き分け — ステイルメイト。';
    }
    return null;
  }

  function refresh() {
    legalHere = pos.legalMoves();
    renderBoard();
    renderCaptured();
    renderMoves();
    if (over) return;
    var end = endMessage();
    if (end) {
      over = true;
      statusEl.textContent = end;
      undoBtn.disabled = false;
      return;
    }
    if (pos.inCheck()) {
      statusEl.textContent = (pos.turn === 1 ? '白' : '黒') + 'の番 — チェック！';
    } else if (thinking) {
      statusEl.textContent = 'AIが考え中…（' + currentLevel().name + '）';
    } else {
      statusEl.textContent = (pos.turn === 1 ? '白' : '黒') + 'の番';
    }
    undoBtn.disabled = history.length === 0 || thinking;
    copyBtn.disabled = history.length === 0;
  }

  function doMove(m, skipNotify) {
    var fenBefore = pos.toFEN();
    var san = E.toSAN(pos, m, legalHere);
    pos.make(m);
    history.push({ m: m, san: san });
    lastMove = m;
    selected = -1;
    if (!skipNotify) notifyWorkerMove(m, fenBefore, pos.toFEN());
    refresh();
  }

  // ---- Worker まわり ----
  function getWorker() {
    if (aiWorker || aiWorkerBroken) return aiWorker;
    try {
      if (typeof Worker === 'undefined') { aiWorkerBroken = true; return null; }
      aiWorker = new Worker('chess-worker.js');
      aiWorker.onmessage = onWorkerMessage;
      aiWorker.onerror = function () { onWorkerError(); };
    } catch (e) {
      aiWorkerBroken = true;
      aiWorker = null;
    }
    return aiWorker;
  }

  function onWorkerError() {
    aiWorkerBroken = true;
    if (aiWorker) {
      try { aiWorker.terminate(); } catch (e) { /* 終了できなくても同期実行に切り替わるだけ */ }
      aiWorker = null;
    }
    // 思考中だったら、その場で同期実行に切り替えて対局を止めない
    if (thinking) aiMoveSync(0);
  }

  function notifyWorkerMove(m, fenBefore, fenAfter) {
    var w = getWorker();
    if (!w) return;
    try {
      w.postMessage({
        type: 'apply',
        move: { from: m.from, to: m.to, promo: m.promo || 0 },
        fenBefore: fenBefore, fenAfter: fenAfter
      });
    } catch (e) { onWorkerError(); }
  }

  // 局面を作り直したときに Worker 側も合わせ直し、思考中だった応答を無効化する
  function syncWorker() {
    thinkId++;
    var w = getWorker();
    if (!w) return;
    try { w.postMessage({ type: 'sync', fen: pos.toFEN() }); } catch (e) { onWorkerError(); }
  }

  function onWorkerMessage(ev) {
    var msg = ev.data || {};
    if (msg.type === 'error') { onWorkerError(); return; }
    if (msg.type !== 'move') return;
    if (!thinking || msg.id !== thinkId) return; // 古い応答は捨てる
    thinking = false;
    if (!msg.move) { refresh(); return; }
    var m = null;
    for (var i = 0; i < legalHere.length; i++) {
      var cand = legalHere[i];
      if (cand.from === msg.move.from && cand.to === msg.move.to && (cand.promo || 0) === (msg.move.promo || 0)) { m = cand; break; }
    }
    if (!m) { refresh(); return; }
    doMove(m, true); // Worker 側は着手済みなので apply は送らない
  }

  // 従来どおりメインスレッドで考える（Worker が使えない環境向け）
  function aiMoveSync(ed) {
    if (over) { thinking = false; return; }
    var lv = currentLevel();
    var m = E.chooseMove(pos, lv.level, 0, ed || 0);
    thinking = false;
    if (!m) { refresh(); return; }
    doMove(m);
  }

  function aiMove(ed) {
    if (ed) { aiMoveSync(ed); return; }
    if (over) { thinking = false; return; }
    var w = getWorker();
    if (!w) { aiMoveSync(0); return; }
    var id = ++thinkId;
    try {
      w.postMessage({ type: 'think', id: id, fen: pos.toFEN(), level: currentLevel().level });
    } catch (e) { onWorkerError(); }
  }

  function maybeAi() {
    if (over || pos.turn !== -1) return;
    thinking = true;
    refresh();
    setTimeout(function () { aiMove(); }, 60);
  }

  function clickSquare(sq) {
    if (over || thinking || pos.turn !== 1) return;
    var p = pos.b[sq];
    if (selected >= 0) {
      var ms = legalFrom(selected).filter(function (m) { return m.to === sq; });
      if (ms.length) {
        // プロモーションはクイーン固定（複数候補があれば promo=5 を選ぶ）
        var m = ms[0];
        for (var i = 0; i < ms.length; i++) if (ms[i].promo === 5) m = ms[i];
        doMove(m);
        maybeAi();
        return;
      }
    }
    if (p > 0) {
      selected = (selected === sq) ? -1 : sq;
      renderBoard();
    } else {
      selected = -1;
      renderBoard();
    }
  }

  function undo() {
    if (thinking || history.length === 0) return;
    var n = 0;
    while (history.length && n < 2) {
      var h = history.pop();
      pos.unmake(h.m);
      n++;
      if (pos.turn === 1) break; // 白の番まで戻す（AIの手＋自分の手＝最大2手）
    }
    over = false;
    lastMove = history.length ? history[history.length - 1].m : null;
    selected = -1;
    syncWorker();
    refresh();
  }

  function newGame() {
    pos = new E.Pos();
    pos.loadFEN(E.START_FEN);
    history = [];
    selected = -1;
    thinking = false;
    over = false;
    lastMove = null;
    syncWorker();
    refresh();
  }

  // 盤面のマスを作る（ボタンなのでキーボードでも選べる）
  for (var sq = 0; sq < 64; sq++) {
    (function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq';
      b.addEventListener('click', function () { clickSquare(s); });
      boardEl.appendChild(b);
    })(sq);
  }
  if (levelEl) {
    levelEl.innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = lv.name;
      if (i === 1) o.selected = true;
      levelEl.appendChild(o);
    });
  }
  undoBtn.addEventListener('click', undo);
  newBtn.addEventListener('click', newGame);
  copyBtn.addEventListener('click', copyMoves);
  if (levelEl) levelEl.addEventListener('change', function () { if (!thinking) refresh(); });

  newGame();

  // テスト用の小さな窓口（vm スタブから動かせる）
  globalThis.KinakoChess = {
    getFEN: function () { return pos.toFEN(); },
    getHistory: function () { return history.map(function (h) { return h.san; }); },
    getStatus: function () { return statusEl.textContent; },
    isThinking: function () { return thinking; },
    isOver: function () { return over; },
    clickSquare: clickSquare,
    aiMove: aiMove,
    newGame: newGame,
    undo: undo,
    loadFEN: function (fen) {
      pos = new E.Pos();
      pos.loadFEN(fen);
      history = [];
      selected = -1;
      thinking = false;
      over = false;
      lastMove = null;
      syncWorker();
      refresh();
    },
    capturedValue: function (color) { return capturedValue(capturedBy(color)); },
    getMovesText: movesText,
    copyMoves: copyMoves
  };
})();
