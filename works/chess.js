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
  var recordEl = $('record');
  var resetRecordBtn = $('reset-record');
  var soundBtn = $('sound-toggle');

  // 通算成績：対局が決着するたびに localStorage にためる（白＝プレイヤー）。
  var RECORD_KEY = 'kinako-chess-record';
  function loadRecord() {
    var rec = { w: 0, l: 0, d: 0 };
    try {
      if (typeof localStorage === 'undefined') return rec;
      var raw = localStorage.getItem(RECORD_KEY);
      if (!raw) return rec;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return rec;
      rec.w = Math.max(0, parseInt(parsed.w, 10) || 0);
      rec.l = Math.max(0, parseInt(parsed.l, 10) || 0);
      rec.d = Math.max(0, parseInt(parsed.d, 10) || 0);
    } catch (e) { /* 読めないときは 0勝0敗0分として扱う */ }
    return rec;
  }
  function saveRecord(rec) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(RECORD_KEY, JSON.stringify(rec));
    } catch (e) { /* 保存できない環境では成績だけ表示しない */ }
  }
  function renderRecord() {
    if (!recordEl) return;
    var rec = loadRecord();
    var total = rec.w + rec.l + rec.d;
    recordEl.textContent = total === 0 ? 'まだ対局はないよ' : rec.w + '勝 ' + rec.l + '敗 ' + rec.d + '分';
  }
  function resetRecord() {
    saveRecord({ w: 0, l: 0, d: 0 });
    renderRecord();
  }

  // 音：WebAudio で指し手の音を鳴らす（素材ファイルは使わない）。
  // 種類: 'move'（指し手）/ 'capture'（取る）/ 'check'（チェック）/ 'win' / 'loss' / 'draw'（決着）。
  var SOUND_KEY = 'kinako-chess-sound';
  var soundOn = loadSound();
  var audioCtx = null;
  var soundLog = []; // 鳴らした音の種類を順にためる（テスト用の窓口。実際の音とは別）
  function loadSound() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(SOUND_KEY) === 'off') return false;
    } catch (e) { /* 読めないときはオンとして扱う */ }
    return true;
  }
  function saveSound(on) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch (e) { /* 保存できない環境では切り替えだけその場で効く */ }
  }
  function renderSound() {
    if (soundBtn) soundBtn.textContent = soundOn ? '音：オン' : '音：オフ';
  }
  function toggleSound() {
    soundOn = !soundOn;
    saveSound(soundOn);
    renderSound();
  }
  function tone(freq, dur, type, gain, delay) {
    if (!audioCtx) return;
    var t0 = audioCtx.currentTime + (delay || 0);
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function playSound(kind) {
    if (!soundOn) return;
    soundLog.push(kind);
    try {
      var AC = (typeof AudioContext !== 'undefined') ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!AC) return; // 音が出せない環境では鳴らした種類だけ記録する
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.resume) audioCtx.resume();
      if (kind === 'move') tone(660, 0.07, 'sine', 0.08);
      else if (kind === 'capture') { tone(220, 0.1, 'triangle', 0.12); tone(160, 0.12, 'sine', 0.08, 0.02); }
      else if (kind === 'check') { tone(880, 0.09, 'sine', 0.1); tone(1174, 0.14, 'sine', 0.1, 0.09); }
      else if (kind === 'win') { tone(523, 0.12, 'sine', 0.1); tone(659, 0.12, 'sine', 0.1, 0.12); tone(784, 0.2, 'sine', 0.1, 0.24); }
      else if (kind === 'loss') { tone(392, 0.14, 'sine', 0.1); tone(311, 0.2, 'sine', 0.1, 0.14); }
      else if (kind === 'draw') { tone(440, 0.12, 'sine', 0.08); tone(440, 0.16, 'sine', 0.08, 0.14); }
    } catch (e) { /* 音が出せない環境では静かにする */ }
  }

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
  var recorded = false; // この対局の決着を成績に記録したか（待ったで戻すと false に戻る）
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

  // 決着の種類：'win'（白＝プレイヤーの勝ち）/ 'loss'（負け）/ 'draw'（引き分け）/ null（続行）
  function endResult() {
    if (pos.insufficient()) return 'draw';
    if (pos.isRepetition && pos.isRepetition()) return 'draw';
    if (typeof pos.half === 'number' && pos.half >= 100) return 'draw';
    if (!pos.hasLegalMove()) {
      if (pos.inCheck()) return pos.turn === 1 ? 'loss' : 'win';
      return 'draw';
    }
    return null;
  }

  function endMessage() {
    // 返すのは null（続行）か、終わったときの文言
    var r = endResult();
    if (!r) return null;
    if (r === 'win') return '白の勝ち — チェックメイト！';
    if (r === 'loss') return '黒の勝ち — チェックメイト！';
    if (pos.insufficient()) return '引き分け — 駒が足りないよ。';
    if (pos.isRepetition && pos.isRepetition()) return '引き分け — 同じ局面が3回出たよ。';
    if (typeof pos.half === 'number' && pos.half >= 100) return '引き分け — 50手ルール。';
    return '引き分け — ステイルメイト。';
  }

  // 決着したら通算成績に1回だけ記録する
  function recordResult() {
    if (recorded) return;
    var r = endResult();
    if (!r) return;
    recorded = true;
    var rec = loadRecord();
    if (r === 'win') rec.w++;
    else if (r === 'loss') rec.l++;
    else rec.d++;
    saveRecord(rec);
    renderRecord();
  }

  function refresh() {
    legalHere = pos.legalMoves();
    renderBoard();
    renderCaptured();
    renderMoves();
    // ボタンの有効・無効は決着時も更新する（決着で早期 return する前に決める）
    undoBtn.disabled = history.length === 0 || thinking;
    copyBtn.disabled = history.length === 0;
    if (over) return;
    var end = endMessage();
    if (end) {
      over = true;
      recordResult();
      statusEl.textContent = end;
      return;
    }
    if (pos.inCheck()) {
      statusEl.textContent = (pos.turn === 1 ? '白' : '黒') + 'の番 — チェック！';
    } else if (thinking) {
      statusEl.textContent = 'AIが考え中…（' + currentLevel().name + '）';
    } else {
      statusEl.textContent = (pos.turn === 1 ? '白' : '黒') + 'の番';
    }
  }

  function doMove(m, skipNotify) {
    var fenBefore = pos.toFEN();
    var san = E.toSAN(pos, m, legalHere);
    pos.make(m);
    history.push({ m: m, san: san });
    lastMove = m;
    selected = -1;
    playSound(moveSoundKind(m));
    if (!skipNotify) notifyWorkerMove(m, fenBefore, pos.toFEN());
    refresh();
  }

  // この手に付ける音の種類：決着＞チェック＞取る＞ふつうの手
  function moveSoundKind(m) {
    var r = endResult();
    if (r) return r; // 'win' / 'loss' / 'draw'
    if (pos.inCheck()) return 'check';
    if (m.cap) return 'capture';
    return 'move';
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
    recorded = false;
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
    recorded = false;
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
  if (resetRecordBtn) resetRecordBtn.addEventListener('click', resetRecord);
  if (soundBtn) soundBtn.addEventListener('click', toggleSound);
  if (levelEl) levelEl.addEventListener('change', function () { if (!thinking) refresh(); });

  newGame();
  renderRecord();
  renderSound();

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
      recorded = false;
      lastMove = null;
      syncWorker();
      refresh();
    },
    capturedValue: function (color) { return capturedValue(capturedBy(color)); },
    getMovesText: movesText,
    copyMoves: copyMoves,
    getRecord: loadRecord,
    resetRecord: resetRecord,
    getSoundOn: function () { return soundOn; },
    toggleSound: toggleSound,
    getSoundLog: function () { return soundLog.slice(); }
  };
})();
