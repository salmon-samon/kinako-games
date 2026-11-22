/* きなこのチェス — AI思考用 Web Worker。
   エンジン本体（chess-engine.js、rookie1.0-pro.4）は無変更で読み込む。
   メインスレッドとは FEN と指し手（from/to/promo）だけで受け渡す。
   共有メモリ（SharedArrayBuffer）は使わないので、ヘッダ設定の無い静的ホスティングでも動く。
   Worker 内に対局中の局面を1つ保持し、メイン側と着手をやり取りして
   局面の履歴（探索内の千日手判定に使う）を同期版と同じように引き継ぐ。
   受け取るメッセージ:
     { type: 'apply', move: {from,to,promo}, fenBefore, fenAfter }  着手を反映する
     { type: 'sync', fen }                          局面を作り直して合わせる（最初から・待った・FEN読み込み）
     { type: 'think', id, fen, level }              思考して { type: 'move', id, move, fen } で返す
   fen が手元の局面と違うときは読み込み直すので、メッセージが欠けても自己回復する。 */
'use strict';
importScripts('chess-engine.js');

var E = self.ChessEngine;
var pos = null;

function freshPos(fen) {
  pos = new E.Pos();
  pos.loadFEN(fen);
  return pos;
}

function ensurePos(fen) {
  if (!pos) return freshPos(fen);
  if (pos.toFEN() !== fen) pos.loadFEN(fen);
  return pos;
}

// from/to/promo から合法手を引く（この3つで手は一意に決まる）
function resolve(p, mv) {
  var legal = p.legalMoves();
  for (var i = 0; i < legal.length; i++) {
    var m = legal[i];
    if (m.from === mv.from && m.to === mv.to && (m.promo || 0) === (mv.promo || 0)) return m;
  }
  return null;
}

function moveData(m) {
  return { from: m.from, to: m.to, promo: m.promo || 0 };
}

self.onmessage = function (ev) {
  var msg = ev.data || {};
  try {
    if (msg.type === 'sync') {
      freshPos(msg.fen);
    } else if (msg.type === 'apply') {
      var p = ensurePos(msg.fenBefore);
      var m = resolve(p, msg.move);
      if (m) p.make(m);
      if (p.toFEN() !== msg.fenAfter) p.loadFEN(msg.fenAfter);
    } else if (msg.type === 'think') {
      var tp = ensurePos(msg.fen);
      var best = E.chooseMove(tp, msg.level, 0, 0);
      if (!best) {
        self.postMessage({ type: 'move', id: msg.id, move: null, fen: tp.toFEN() });
        return;
      }
      tp.make(best);
      self.postMessage({ type: 'move', id: msg.id, move: moveData(best), fen: tp.toFEN() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id || 0, message: String(err && err.message || err) });
  }
};
