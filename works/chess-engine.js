/* rookie1.0-pro.4
 * quickの高速評価(evalF)をベースに、探索の質を極限まで高めた全方位強化版。
 * 500ms〜60秒のどの時間制御でもquickを上回ることを目指す。
globalThis.ChessEngine のみを公開。
 * 公開名は Index.html が依存しているためChessEngine のまま。
 * バージョン: ChessEngine.VERSION で取得可能。
 */
(function(){
'use strict';

const PAWN=1,KNIGHT=2,BISHOP=3,ROOK=4,QUEEN=5,KING=6;
const F_EP=1,F_CK=2,F_CQ=4,F_DP=8;
const START_FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const INF=32000,MATE=30000,MAXPLY=128;
const VAL=[0,100,325,335,500,950,0];
const PROMO_ALL=[5,4,3,2],PROMO_Q=[5];

/* ---- 事前計算(quickと同一) ---- */
const KN=[],KG=[],RAYS=[];
(function(){
  const kn=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const kg=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for(let s=0;s<64;s++){
    const r=s>>3,c=s&7;
    KN[s]=[];KG[s]=[];RAYS[s]=[];
    for(const d of kn){const rr=r+d[0],cc=c+d[1];if(rr>=0&&rr<8&&cc>=0&&cc<8)KN[s].push(rr*8+cc);}
    for(const d of kg){const rr=r+d[0],cc=c+d[1];if(rr>=0&&rr<8&&cc>=0&&cc<8)KG[s].push(rr*8+cc);}
    for(const d of dirs){
      const ray=[];let rr=r+d[0],cc=c+d[1];
      while(rr>=0&&rr<8&&cc>=0&&cc<8){ray.push(rr*8+cc);rr+=d[0];cc+=d[1];}
      RAYS[s].push(ray);
    }
  }
})();

/* ---- Zobrist ---- */
let _seed=0x2545F491;
function rnd32(){_seed=(_seed+0x6D2B79F5)|0;let t=Math.imul(_seed^(_seed>>>15),1|_seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return (t^(t>>>14))|0;}
const Z1=new Int32Array(13*64),Z2=new Int32Array(13*64);
const ZC1=new Int32Array(16),ZC2=new Int32Array(16);
const ZE1=new Int32Array(8),ZE2=new Int32Array(8);
for(let i=0;i<Z1.length;i++){Z1[i]=rnd32();Z2[i]=rnd32();}
for(let i=0;i<16;i++){ZC1[i]=rnd32();ZC2[i]=rnd32();}
for(let i=0;i<8;i++){ZE1[i]=rnd32();ZE2[i]=rnd32();}
const ZS1=rnd32(),ZS2=rnd32();

const CMASK=new Uint8Array(64).fill(15);
CMASK[60]=12;CMASK[56]=13;CMASK[63]=14;CMASK[4]=3;CMASK[0]=7;CMASK[7]=11;

/* ---- 評価テーブル ---- */
const PST=[null,
[0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
[-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
[-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
[0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
[-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20]];
const KMG=[-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20];
const KEG=[-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

function mk(from,to,piece,cap,promo,flags){
  return {from:from,to:to,piece:piece,cap:cap,promo:promo,flags:flags,
    enc:from|(to<<6)|(promo<<12)|(flags<<16),score:0};
}

/* EPマスへ手番側ポーンが実際に取れるか(取られる敵ポーンの存在+取り手の存在)。
   取れないEPは局面同一性に影響しないためハッシュへ含めない */
function epCapturable(b,ep,turn){
  if(ep<0)return false;
  const cs=ep+(turn===1?8:-8);
  if(cs<0||cs>63||b[cs]!==-turn*PAWN)return false;
  const c=ep&7;
  if(c>0&&b[cs-1]===turn*PAWN)return true;
  if(c<7&&b[cs+1]===turn*PAWN)return true;
  return false;
}

/* ========================================================================
   Posクラス(quickと互換 + 非ポーン駒カウンタ + undo に move 保存)
   ======================================================================== */
class Pos{
  constructor(){
    this.b=new Int8Array(64);
    this.turn=1;this.castle=0;this.ep=-1;this.half=0;this.full=1;
    this.kingSq=[60,4];
    this.pc=[0,0]; /* 非ポーン駒数 [white, black] */
    this.h1=0;this.h2=0;
    this.stack=[];this.hist=[];
  }
  loadFEN(fen){
    const parts=fen.trim().split(/\s+/);
    /* 不正FENは黙って変な状態を作るより例外を投げる(呼び出し側で検知できる) */
    if(parts.length<2)throw new Error('invalid FEN (too few fields): '+fen);
    if(parts[1]!=='w'&&parts[1]!=='b')throw new Error('invalid FEN (side to move): '+fen);
    this.b.fill(0);
    this.pc[0]=0;this.pc[1]=0;
    this.kingSq=[60,4]; /* キング不在の不正FENでも前回の値が残らないようにリセット */
    let sq=0,wk=0,bk=0;
    for(const ch of parts[0]){
      if(ch==='/')continue;
      if(ch>='1'&&ch<='8'){sq+=+ch;continue;}
      const lower=ch.toLowerCase();
      const type='pnbrqk'.indexOf(lower)+1;
      if(type===0)throw new Error('invalid FEN (piece char): '+fen);
      if(sq>63)throw new Error('invalid FEN (board overflow): '+fen);
      const color=ch===lower?-1:1;
      /* ポーンは2〜7段目のみ(1/8段目のポーンは不正) */
      if(type===PAWN&&(sq<8||sq>=56))throw new Error('invalid FEN (pawn rank): '+fen);
      this.b[sq]=type*color;
      if(type===KING){this.kingSq[color===1?0:1]=sq;if(color===1)wk++;else bk++;}
      else if(type!==PAWN)this.pc[color===1?0:1]++;
      sq++;
    }
    if(sq!==64)throw new Error('invalid FEN (board size): '+fen);
    /* 各色キングはちょうど1枚 */
    if(wk!==1||bk!==1)throw new Error('invalid FEN (king count): '+fen);
    this.turn=parts[1]==='b'?-1:1;
    let c=0;const cs=parts[2]||'-';
    if(cs.indexOf('K')>=0)c|=1;
    if(cs.indexOf('Q')>=0)c|=2;
    if(cs.indexOf('k')>=0)c|=4;
    if(cs.indexOf('q')>=0)c|=8;
    this.castle=c;
    /* epは明示的にクランプ。不正入力(例: z9)でNaNがハッシュXORに混入しない */
    /* EP整合性(ランクが手番と合う+取られる敵ポーンが存在)も検証し、不整合なら無効化 */
    this.ep=-1;
    if(parts[3]&&parts[3]!=='-'){
      const fc='abcdefgh'.indexOf(parts[3][0]);
      const fr=parseInt(parts[3][1],10);
      if(fc>=0&&fr>=1&&fr<=8){
        const cand=fc+(8-fr)*8;
        const wantRank=this.turn===1?6:3;
        const epCapSq=cand+(this.turn===1?8:-8);
        if(fr===wantRank&&epCapSq>=0&&epCapSq<64&&this.b[epCapSq]===-this.turn*PAWN)this.ep=cand;
      }
    }
    this.half=parseInt(parts[4]||'0',10)||0;
    this.full=parseInt(parts[5]||'1',10)||1;
    this.stack=[];
    this.computeHash();
    this.hist=[this.h1];
  }
  computeHash(){
    let h1=0,h2=0;
    for(let s=0;s<64;s++){
      const p=this.b[s];
      if(p){const i=(p+6)*64+s;h1^=Z1[i];h2^=Z2[i];}
    }
    if(this.turn===-1){h1^=ZS1;h2^=ZS2;}
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    /* 取れないEPはハッシュに含めない */
    if(epCapturable(this.b,this.ep,this.turn)){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    this.h1=h1;this.h2=h2;
  }
  attacked(sq,by){
    const b=this.b,r=sq>>3,c=sq&7;
    const pr=by===1?r+1:r-1;
    if(pr>=0&&pr<8){
      if(c>0&&b[pr*8+c-1]===by)return true;
      if(c<7&&b[pr*8+c+1]===by)return true;
    }
    const kn=KN[sq];
    for(let i=0;i<kn.length;i++)if(b[kn[i]]===by*2)return true;
    const kg=KG[sq];
    for(let i=0;i<kg.length;i++)if(b[kg[i]]===by*6)return true;
    const rays=RAYS[sq];
    for(let d=0;d<8;d++){
      const ray=rays[d];
      for(let i=0;i<ray.length;i++){
        const p=b[ray[i]];
        if(p!==0){
          /* d<4=縦横(ルーク)、d>=4=斜め(ビショップ)。クイーンは両方 */
          if(p===by*5)return true;
          if(p===by*(d<4?ROOK:BISHOP))return true;
          break;
        }
      }
    }
    return false;
  }
  inCheck(){return this.attacked(this.kingSq[this.turn===1?0:1],-this.turn);}
  illegal(){return this.attacked(this.kingSq[this.turn===1?1:0],this.turn);}
  gen(caps){
    const b=this.b,us=this.turn,moves=[];
    for(let s=0;s<64;s++){
      const p=b[s];
      if(p*us<=0)continue;
      const t=p*us;
      if(t===PAWN){
        const dir=us===1?-8:8,r=s>>3,c=s&7;
        const promoRow=us===1?1:6,startRow=us===1?6:1;
        const promos=caps?PROMO_Q:PROMO_ALL;
        const f=s+dir;
        if(b[f]===0){
          if(r===promoRow){for(let i=0;i<promos.length;i++)moves.push(mk(s,f,p,0,promos[i],0));}
          else if(!caps){
            moves.push(mk(s,f,p,0,0,0));
            if(r===startRow&&b[f+dir]===0)moves.push(mk(s,f+dir,p,0,0,F_DP));
          }
        }
        for(let k=-1;k<=1;k+=2){
          const cc=c+k;
          if(cc<0||cc>7)continue;
          const to=f+k,q=b[to];
          if(q*us<0){
            if(r===promoRow){for(let i=0;i<promos.length;i++)moves.push(mk(s,to,p,q,promos[i],0));}
            else moves.push(mk(s,to,p,q,0,0));
          }else if(q===0&&to===this.ep&&b[to+(us===1?8:-8)]===-us*PAWN){
            /* EP先の後ろに敵ポーンが存在するときだけ生成(幽霊アンパッサン防止) */
            moves.push(mk(s,to,p,-us*PAWN,0,F_EP));
          }
        }
      }else if(t===KNIGHT||t===KING){
        const list=t===KNIGHT?KN[s]:KG[s];
        for(let i=0;i<list.length;i++){
          const to=list[i],q=b[to];
          if(q===0){if(!caps)moves.push(mk(s,to,p,0,0,0));}
          else if(q*us<0)moves.push(mk(s,to,p,q,0,0));
        }
        if(t===KING&&!caps){
          if(us===1&&s===60){
            if((this.castle&1)&&b[61]===0&&b[62]===0&&b[63]===4&&!this.attacked(60,-1)&&!this.attacked(61,-1)&&!this.attacked(62,-1))moves.push(mk(60,62,p,0,0,F_CK));
            if((this.castle&2)&&b[59]===0&&b[58]===0&&b[57]===0&&b[56]===4&&!this.attacked(60,-1)&&!this.attacked(59,-1)&&!this.attacked(58,-1))moves.push(mk(60,58,p,0,0,F_CQ));
          }else if(us===-1&&s===4){
            if((this.castle&4)&&b[5]===0&&b[6]===0&&b[7]===-4&&!this.attacked(4,1)&&!this.attacked(5,1)&&!this.attacked(6,1))moves.push(mk(4,6,p,0,0,F_CK));
            if((this.castle&8)&&b[3]===0&&b[2]===0&&b[1]===0&&b[0]===-4&&!this.attacked(4,1)&&!this.attacked(3,1)&&!this.attacked(2,1))moves.push(mk(4,2,p,0,0,F_CQ));
          }
        }
      }else{
        const d0=t===BISHOP?4:0,d1=t===ROOK?4:8;
        const rays=RAYS[s];
        for(let d=d0;d<d1;d++){
          const ray=rays[d];
          for(let i=0;i<ray.length;i++){
            const to=ray[i],q=b[to];
            if(q===0){if(!caps)moves.push(mk(s,to,p,0,0,0));}
            else{if(q*us<0)moves.push(mk(s,to,p,q,0,0));break;}
          }
        }
      }
    }
    return moves;
  }
  make(m){
    const b=this.b,us=this.turn,from=m.from,to=m.to,p=m.piece;
    let h1=this.h1,h2=this.h2,i;
    const u={castle:this.castle,ep:this.ep,half:this.half,h1:h1,h2:h2,cap:0,move:m};
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    if(epCapturable(this.b,this.ep,this.turn)){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    i=(p+6)*64+from;h1^=Z1[i];h2^=Z2[i];
    b[from]=0;
    let cap;
    if(m.flags&F_EP){
      const cs=to+(us===1?8:-8);
      cap=b[cs];b[cs]=0;
      i=(cap+6)*64+cs;h1^=Z1[i];h2^=Z2[i];
    }else{
      cap=b[to];
      if(cap){i=(cap+6)*64+to;h1^=Z1[i];h2^=Z2[i];}
    }
    /* m.capはgen()が設定した値をそのまま使う。makeがムーブオブジェクトを書き換えない
       (make/unmakeで使い回すムーブが直前のmakeに汚染されない設計にする) */
    u.cap=cap;
    /* 非ポーン駒数の更新 */
    if(cap!==0){
      const ct=cap>0?cap:-cap;
      if(ct!==PAWN&&ct!==KING)this.pc[cap>0?0:1]--;
    }
    const placed=m.promo?m.promo*us:p;
    if(m.promo)this.pc[us>0?0:1]++;
    b[to]=placed;
    i=(placed+6)*64+to;h1^=Z1[i];h2^=Z2[i];
    if(m.flags&(F_CK|F_CQ)){
      const rf=(m.flags&F_CK)?to+1:to-2;
      const rt=(m.flags&F_CK)?to-1:to+1;
      const rook=b[rf];
      b[rf]=0;b[rt]=rook;
      i=(rook+6)*64+rf;h1^=Z1[i];h2^=Z2[i];
      i=(rook+6)*64+rt;h1^=Z1[i];h2^=Z2[i];
    }
    if(p===us*KING)this.kingSq[us===1?0:1]=to;
    this.castle&=CMASK[from]&CMASK[to];
    this.ep=(m.flags&F_DP)?((from+to)>>1):-1;
    if(p===us*PAWN||cap)this.half=0;else this.half++;
    if(us===-1)this.full++;
    this.turn=-us;
    h1^=ZS1;h2^=ZS2;
    h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    if(epCapturable(this.b,this.ep,this.turn)){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    this.h1=h1;this.h2=h2;
    this.stack.push(u);this.hist.push(h1);
  }
  unmake(m){
    const u=this.stack.pop();this.hist.pop();
    const b=this.b,us=-this.turn,from=m.from,to=m.to;
    this.turn=us;
    /* 非ポーン駒数の復元 */
    if(u.cap!==0){
      const ct=u.cap>0?u.cap:-u.cap;
      if(ct!==PAWN&&ct!==KING)this.pc[u.cap>0?0:1]++;
    }
    if(m.promo)this.pc[us>0?0:1]--;
    b[from]=m.piece;
    if(m.flags&F_EP){b[to]=0;b[to+(us===1?8:-8)]=u.cap;}
    else b[to]=u.cap;
    if(m.flags&(F_CK|F_CQ)){
      const rf=(m.flags&F_CK)?to+1:to-2;
      const rt=(m.flags&F_CK)?to-1:to+1;
      b[rf]=b[rt];b[rt]=0;
    }
    if(m.piece===us*KING)this.kingSq[us===1?0:1]=from;
    this.castle=u.castle;this.ep=u.ep;this.half=u.half;this.h1=u.h1;this.h2=u.h2;
    if(us===-1)this.full--;
  }
  legalMoves(){
    const out=[],ms=this.gen(false);
    for(let i=0;i<ms.length;i++){
      const m=ms[i];
      this.make(m);
      if(!this.illegal())out.push(m);
      this.unmake(m);
    }
    return out;
  }
  hasLegalMove(){
    const ms=this.gen(false);
    for(let i=0;i<ms.length;i++){
      const m=ms[i];
      this.make(m);
      const ok=!this.illegal();
      this.unmake(m);
      if(ok)return true;
    }
    return false;
  }
  repCount(){
    let n=1;const len=this.hist.length;
    const lim=Math.max(0,len-1-this.half);
    for(let i=len-3;i>=lim;i-=2)if(this.hist[i]===this.h1)n++;
    return n;
  }
  isRepetition(){
    const len=this.hist.length;
    const lim=Math.max(0,len-1-this.half);
    for(let i=len-3;i>=lim;i-=2)if(this.hist[i]===this.h1)return true;
    return false;
  }
  /* 駒不足引き分け判定。allBc: 両軍通算のビショップマス色 -2=なし -1=両色 0/1=その色のみ */
  insufficient(){
    let minors=0,knights=0,allBc=-2;
    for(let s=0;s<64;s++){
      const v=this.b[s],t=v<0?-v:v;
      if(t===PAWN||t===ROOK||t===QUEEN)return false;
      if(t===KNIGHT){minors++;knights++;}
      else if(t===BISHOP){
        minors++;
        const col=((s>>3)+(s&7))&1;
        if(allBc===-2)allBc=col;else if(allBc!==col)allBc=-1;
      }
    }
    if(minors<=1)return true;                       /* K vs K, K+m vs K */
    /* 両軍通算でナイト無し+全ビショップ同色マスならデッドポジション */
    /* K+N vs K+N はヘルプメイト可能なため引き分けにしない(FIDE厳密) */
    return knights===0&&allBc>=0;
  }
  makeNull(){
    const u={castle:this.castle,ep:this.ep,half:this.half,h1:this.h1,h2:this.h2,cap:0,move:null};
    let h1=this.h1,h2=this.h2;
    if(epCapturable(this.b,this.ep,this.turn)){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    h1^=ZS1;h2^=ZS2;
    this.ep=-1;this.turn=-this.turn; /* halfは据え置き(null moveで50手カウンタを進めると偽の引き分けが出る) */
    this.h1=h1;this.h2=h2;
    this.stack.push(u);this.hist.push(h1);
  }
  unmakeNull(){
    const u=this.stack.pop();this.hist.pop();
    this.turn=-this.turn;this.ep=u.ep;this.half=u.half;this.h1=u.h1;this.h2=u.h2;
  }
  hasPieces(us){
    return this.pc[us>0?0:1]>0;
  }
  /* FEN生成(loadFENと往復可能。検証用) */
  toFEN(){
    const b=this.b;
    let s='';
    for(let r=0;r<8;r++){
      let e=0;
      for(let c=0;c<8;c++){
        const p=b[r*8+c];
        if(p===0){e++;continue;}
        if(e){s+=e;e=0;}
        const ch=' PNBRQK'[p>0?p:-p];
        s+=p>0?ch:ch.toLowerCase();
      }
      if(e)s+=e;
      if(r<7)s+='/';
    }
    s+=this.turn===1?' w ':' b ';
    let cs='';
    if(this.castle&1)cs+='K';
    if(this.castle&2)cs+='Q';
    if(this.castle&4)cs+='k';
    if(this.castle&8)cs+='q';
    s+=cs||'-';
    s+=' ';
    s+=this.ep>=0?('abcdefgh'[this.ep&7]+(8-(this.ep>>3))):'-';
    s+=' '+this.half+' '+this.full;
    return s;
  }
}

function perft(pos,d){
  if(d<=0)return 1; /* 負数/小数でも無限再帰しない */
  let n=0;
  const ms=pos.gen(false);
  for(let i=0;i<ms.length;i++){
    const m=ms[i];
    pos.make(m);
    if(!pos.illegal())n+=perft(pos,d-1);
    pos.unmake(m);
  }
  return n;
}

/* ========================================================================
   評価関数
   ======================================================================== */
/* EV.badBishop: 悪いビショップ評価のON/OFF
   EV.threat: 敵ポーン攻撃による脅威のみ(非ポーン駒からの攻撃はコスト大のため未実装) */
const EV={badBishop:1,pawn:1,passed:1,outpost:1,rook:1,mob:1,king:1,threat:1,tempo:1,mop:1};
const PASS_MG=[0,0,6,12,24,44,72,0],PASS_EG=[0,6,14,30,56,96,150,0];
const PCONN=[0,0,4,6,9,16,24,0];
const PKRW=[0,0,0,1,1,2,3,0];
const THREAT=[0,0,12,12,20,30,0];
const ATK_W=[0,0,20,20,40,80,0];
const ATK_FAC=[0,0,55,75,88,94,98,100,100];
const wAtt=new Uint8Array(64),bAtt=new Uint8Array(64),zW=new Uint8Array(64),zB=new Uint8Array(64);
const wCnt=new Int8Array(10),bCnt=new Int8Array(10),wMax=new Int8Array(10),bMin=new Int8Array(10);
const wpSq=new Int8Array(16),bpSq=new Int8Array(16),pcSq=new Int8Array(64);

function kdist(a,f){
  const dr=(a>>3)-(f>>3),dc=(a&7)-(f&7);
  return Math.max(dr<0?-dr:dr,dc<0?-dc:dc);
}

/* 対称丸め(ties-to-even)。Math.round は x.5 で +∞ 側に寄せるため
   ミラー局面で評価が ±1cp ずれる非対称が稀に発生する。round(-x)==-round(x) を保証する */
function rint(x){
  const f=Math.floor(x),d=x-f;
  if(d>0.5)return f+1;
  if(d<0.5)return f;
  return (f&1)?f+1:f;
}

function evalF(pos){
  const b=pos.b;
  const needAtt=(EV.pawn||EV.threat||EV.mob||EV.king)!==0;    /* mob/king走査もwAtt/bAttを使うため含める */
  const needKing=EV.king!==0;                                 /* zW/zB: キングゾーン攻撃で使用 */
  const needCnt=(EV.pawn||EV.passed||EV.rook||EV.outpost||EV.king)!==0; /* wCnt/bCnt/wMax/bMin */
  let sc=0,npm=0,bw=0,bb=0,minors=0,others=0,mg=0,eg=0;
  let wPawns=0,bPawns=0,matW=0,matB=0;
  if(needAtt){wAtt.fill(0);bAtt.fill(0);}
  if(needKing){zW.fill(0);zB.fill(0);}
  if(needCnt){wCnt.fill(0);bCnt.fill(0);wMax.fill(-1);bMin.fill(8);}
  let nw=0,nb=0,np=0,qW=0,qB=0,wBc=-2,bBc=-2; /* wBc/bBc:ビショップのマス色 -2=なし -1=両色 0/1=その色のみ */
  for(let s=0;s<64;s++){
    const p=b[s];
    if(p===0)continue;
    const t=p>0?p:-p;
    const r=s>>3,c=s&7;
    if(t===KING)continue;
    if(t===PAWN){
      others++;
      if(p>0){
        wPawns++;
        sc+=100+PST[1][s];wpSq[nw++]=s;
        if(needCnt){wCnt[c+1]++;if(r>wMax[c+1])wMax[c+1]=r;}
        if(needAtt&&r>0){if(c>0)wAtt[s-9]=1;if(c<7)wAtt[s-7]=1;}
      }else{
        bPawns++;
        sc-=100+PST[1][s^56];bpSq[nb++]=s;
        if(needCnt){bCnt[c+1]++;if(r<bMin[c+1])bMin[c+1]=r;}
        if(needAtt&&r<7){if(c>0)bAtt[s+7]=1;if(c<7)bAtt[s+9]=1;}
      }
      continue;
    }
    npm+=VAL[t];
    if(t===KNIGHT||t===BISHOP)minors++;else others++;
    pcSq[np++]=s;
    if(p>0){sc+=VAL[t]+PST[t][s];matW+=VAL[t];if(t===BISHOP){bw++;const col=(r+c)&1;if(wBc===-2)wBc=col;else if(wBc!==col)wBc=-1;}if(t===QUEEN)qW++;}
    else{sc-=VAL[t]+PST[t][s^56];matB+=VAL[t];if(t===BISHOP){bb++;const col=(r+c)&1;if(bBc===-2)bBc=col;else if(bBc!==col)bBc=-1;}if(t===QUEEN)qB++;}
  }
  if(others===0){
    if(minors<=1)return 0; /* K vs K, K+m vs K, K+m vs K+m */
    /* insufficient()と一致させる(両軍通算でナイト無し+全ビショップ同色なら引き分け) */
    if(bw+bb===minors&&bw+bb>0){
      const uni=bw===0?bBc:(bb===0?wBc:(wBc>=0&&wBc===bBc?wBc:-1));
      if(uni>=0)return 0;
    }
  }
  /* (既知の制限)phは非ポーン駒価値のみで計算。ポーンのみの終盤はph=0で正しいが、
     「ポーンが多く残っている序盤」でも非ポーン駒が少ないとphが下がる。実用上は許容範囲とする */
  const ph=Math.min(1,npm/4000);
  const kwSq=pos.kingSq[0],kbSq=pos.kingSq[1];
  const kw=kwSq,kb=kbSq^56;

  if(EV.pawn||EV.passed){
    for(let i=0;i<nw;i++){
      const s=wpSq[i],r=s>>3,c=s&7,rr=7-r,cc=c+1;
      const iso=wCnt[cc-1]===0&&wCnt[cc+1]===0;
      const sup=(c>0&&b[s+7]===1)||(c<7&&b[s+9]===1);
      const pass=bMin[cc-1]>=r&&bMin[cc]>=r&&bMin[cc+1]>=r;
      if(EV.pawn){
        /* 孤立+オープンファイルは狙い撃ちされるのでさらに減点(ヒューリスティック) */
        if(iso){mg-=10;eg-=16;if(bCnt[cc]===0)mg-=6;}
        else if(!sup&&!pass&&wMax[cc-1]<r&&wMax[cc+1]<r&&r>0&&bAtt[s-8]){mg-=8;eg-=10;}
        if(sup||(c>0&&b[s-1]===1)||(c<7&&b[s+1]===1)){mg+=PCONN[rr];eg+=PCONN[rr];}
      }
      if(EV.passed&&pass){
        let pm=PASS_MG[rr],pe=PASS_EG[rr];
        if(r>0){
          const fr=s-8;
          if(b[fr]!==0){pm>>=1;pe=(pe*2/3)|0;}
          if(rr>=3)pe+=(4*kdist(kbSq,fr)-2*kdist(kwSq,fr))*PKRW[rr];
        }
        mg+=pm;eg+=pe;
      }
    }
    for(let i=0;i<nb;i++){
      const s=bpSq[i],r=s>>3,c=s&7,rr=r,cc=c+1;
      const iso=bCnt[cc-1]===0&&bCnt[cc+1]===0;
      const sup=(c>0&&b[s-9]===-1)||(c<7&&b[s-7]===-1);
      const pass=wMax[cc-1]<=r&&wMax[cc]<=r&&wMax[cc+1]<=r;
      if(EV.pawn){
        /* 孤立+オープンファイルは狙い撃ちされるのでさらに減点(ヒューリスティック) */
        if(iso){mg+=10;eg+=16;if(wCnt[cc]===0)mg+=6;}
        else if(!sup&&!pass&&bMin[cc-1]>r&&bMin[cc+1]>r&&r<7&&wAtt[s+8]){mg+=8;eg+=10;}
        if(sup||(c>0&&b[s-1]===-1)||(c<7&&b[s+1]===-1)){mg-=PCONN[rr];eg-=PCONN[rr];}
      }
      if(EV.passed&&pass){
        let pm=PASS_MG[rr],pe=PASS_EG[rr];
        if(r<7){
          const fr=s+8;
          if(b[fr]!==0){pm>>=1;pe=(pe*2/3)|0;}
          if(rr>=3)pe+=(4*kdist(kwSq,fr)-2*kdist(kbSq,fr))*PKRW[rr];
        }
        mg-=pm;eg-=pe;
      }
    }
    if(EV.pawn){
      for(let f=1;f<=8;f++){
        if(wCnt[f]>1){mg-=(wCnt[f]-1)*8;eg-=(wCnt[f]-1)*16;}
        if(bCnt[f]>1){mg+=(bCnt[f]-1)*8;eg+=(bCnt[f]-1)*16;}
      }
    }
  }

  let aUw=0,aNw=0,aUb=0,aNb=0;
  if(EV.king){
    zW[kwSq]=1;zB[kbSq]=1;
    const gw=KG[kwSq],gb=KG[kbSq];
    for(let i=0;i<gw.length;i++)zW[gw[i]]=1;
    for(let i=0;i<gb.length;i++)zB[gb[i]]=1;
  }
  const doScan=EV.mob||EV.king;
  for(let i=0;i<np;i++){
    const s=pcSq[i],p=b[s],white=p>0,t=white?p:-p;
    const r=s>>3,c=s&7,cc=c+1;
    let m1=0,e1=0;
    if(doScan){
      const eAtt=white?bAtt:wAtt,zE=needKing?(white?zB:zW):null;
      let cnt=0,hit=0;
      if(t===KNIGHT){
        const a=KN[s];
        for(let k=0;k<a.length;k++){
          const to=a[k];
          if(needKing&&zE[to])hit=1;
          const q=b[to];
          if(q!==0&&(q>0)===white)continue;
          if(!eAtt[to])cnt++;
        }
      }else{
        const rays=RAYS[s];
        const d0=t===BISHOP?4:0,d1=t===ROOK?4:8;
        for(let d=d0;d<d1;d++){
          const ray=rays[d];
          for(let k=0;k<ray.length;k++){
            const to=ray[k];
            if(needKing&&zE[to])hit=1;
            const q=b[to];
            if(q===0){if(!eAtt[to])cnt++;continue;}
            if((q>0)!==white&&!eAtt[to])cnt++;
            break;
          }
        }
      }
      if(EV.mob){
        if(t===KNIGHT){m1+=(cnt-4)*4;e1+=(cnt-4)*4;}
        else if(t===BISHOP){m1+=(cnt-6)*5;e1+=(cnt-6)*5;}
        else if(t===ROOK){m1+=(cnt-7)*2;e1+=(cnt-7)*4;}
        else{m1+=cnt-13;e1+=(cnt-13)*2;}
      }
      if(hit){if(white){aNw++;aUw+=ATK_W[t];}else{aNb++;aUb+=ATK_W[t];}}
    }
    if(EV.outpost&&t===KNIGHT&&c>=1&&c<=6){
      if(white){
        const rr=7-r;
        if(rr>=3&&rr<=5&&bMin[cc-1]>=r&&bMin[cc+1]>=r){
          if((c>0&&b[s+7]===1)||(c<7&&b[s+9]===1)){m1+=22;e1+=16;}else{m1+=8;e1+=6;}
        }
      }else if(r>=3&&r<=5&&wMax[cc-1]<=r&&wMax[cc+1]<=r){
        if((c>0&&b[s-9]===-1)||(c<7&&b[s-7]===-1)){m1+=22;e1+=16;}else{m1+=8;e1+=6;}
      }
    }
    if(EV.rook&&t===ROOK){
      const own=white?wCnt[cc]:bCnt[cc],opp=white?bCnt[cc]:wCnt[cc];
      if(own===0){
        if(opp===0){m1+=22;e1+=12;}else{m1+=10;e1+=6;}
      }
      if(white?(r===1&&(kbSq>>3)===0):(r===6&&(kwSq>>3)===7)){m1+=14;e1+=22;}
    }
    /* 悪いビショップ(自分のポーンがビショップと同色マスに多いほど減点)。白黒対称 */
    if(EV.badBishop&&t===BISHOP){
      const bc=(r+c)&1;
      let same=0;
      for(let k=0;k<(white?nw:nb);k++){
        const ps=white?wpSq[k]:bpSq[k];
        if((((ps>>3)+(ps&7))&1)===bc)same++;
      }
      m1-=same*3;e1-=same*3;
    }
    if(white){mg+=m1;eg+=e1;}else{mg-=m1;eg-=e1;}
    if(EV.threat&&(white?bAtt[s]:wAtt[s])){
      if(white)sc-=THREAT[t];else sc+=THREAT[t];
    }
  }

  if(EV.king){
    if(aNw>=2){let pen=(aUw*ATK_FAC[aNw>8?8:aNw]/100)|0;if(qW===0)pen>>=1;mg+=pen;}
    if(aNb>=2){let pen=(aUb*ATK_FAC[aNb>8?8:aNb]/100)|0;if(qB===0)pen>>=1;mg-=pen;}
    const kwr=kwSq>>3,kwc=kwSq&7;
    if(kwr>=6){
      for(let f=(kwc>0?kwc-1:0);f<=(kwc<7?kwc+1:7);f++){
        if(b[(kwr-1)*8+f]===1)mg+=12;
        else if(kwr>=2&&b[(kwr-2)*8+f]===1)mg+=6;
        else{mg-=14;if(wCnt[f+1]===0){mg-=6;if(bCnt[f+1]===0)mg-=6;}}
      }
    }
    const kbr=kbSq>>3,kbc=kbSq&7;
    if(kbr<=1){
      for(let f=(kbc>0?kbc-1:0);f<=(kbc<7?kbc+1:7);f++){
        if(b[(kbr+1)*8+f]===-1)mg-=12;
        else if(kbr<=5&&b[(kbr+2)*8+f]===-1)mg-=6;
        else{mg+=14;if(bCnt[f+1]===0){mg+=6;if(wCnt[f+1]===0)mg+=6;}}
      }
    }
  }

  sc+=rint(mg*ph+eg*(1-ph));
  sc+=(KMG[kw]*ph+KEG[kw]*(1-ph))-(KMG[kb]*ph+KEG[kb]*(1-ph));
  if(bw>=2)sc+=30;
  if(bb>=2)sc-=30;

  /* Mop-up eval: ポーンなし + 素材差が大きい場合、相手キングを駆逐 */
  if(EV.mop&&wPawns===0&&bPawns===0&&Math.abs(matW-matB)>=400){
    const winner=matW>matB?0:1;
    const wK=pos.kingSq[0],bK=pos.kingSq[1];
    const wK2=winner===0?wK:bK;
    const lK=winner===0?bK:wK;
    const wkr=wK2>>3,wkc=wK2&7;
    const lkr=lK>>3,lkc=lK&7;
    const kingDist=Math.max(Math.abs(wkr-lkr),Math.abs(wkc-lkc));
    const edge=Math.min(lkr,7-lkr,lkc,7-lkc);
    const mop=4*(14-kingDist)+2*(7-edge);
    sc+=winner===0?mop:-mop;
  }

  sc=rint(sc);
  const stm=pos.turn===1?sc:-sc;
  if(EV.tempo)return stm+8;
  return stm;
}

/* evalF そのものの別名として公開(将来evalFを差し替えても追従する) */
const evaluate=evalF;

/* ========================================================================
   置換表(2スロットバケット + 世代管理)
   1局面1スロットの上書きでは深い結果が浅い結果に追い出されるため、
   バケット2エントリ化し「深さが最も低い」エントリを置換する(同一depthなら古い世代)。
   世代の重みは深さの2倍(quality = depth - 2*世代差)で評価し、
   古いエントリの方を優先的に追い出す。
   ======================================================================== */
let TT_BITS=19; /* バケットインデックスのビット数。総スロット数は 2^(TT_BITS+1) */
let TTB_MASK=(1<<19)-1,TT_SIZE=(1<<19)*2;
let TTlock=new Int32Array(TT_SIZE),TTscore=new Int32Array(TT_SIZE);
let TTdepth=new Int8Array(TT_SIZE),TTflag=new Int8Array(TT_SIZE),TTmove=new Int32Array(TT_SIZE);
let TTage=new Uint16Array(TT_SIZE);

/* バケット内から同一局面のスロットを探す。見つからなければ-1 */
function ttProbe(h1,h2){
  const base=(h1&TTB_MASK)<<1;
  if(TTflag[base]!==0&&TTlock[base]===h2)return base;
  const s2=base+1;
  if(TTflag[s2]!==0&&TTlock[s2]===h2)return s2;
  return -1;
}

/* バケット置換ポリシー:
   1) 同一局面の既存スロットは上書き(新しい情報を優先。qsearchのdepth=0保存も同様)
   2) 空きスロットがあればそこへ
   3) quality = depth - 2*世代差 が最小のスロットへ(同一depthなら古い世代を追い出す) */
function ttStore(h1,h2,st,depth,enc,flag){
  const s1=(h1&TTB_MASK)<<1,s2=s1+1;
  let slot;
  if(TTflag[s1]!==0&&TTlock[s1]===h2)slot=s1;
  else if(TTflag[s2]!==0&&TTlock[s2]===h2)slot=s2;
  else if(TTflag[s1]===0)slot=s1;
  else if(TTflag[s2]===0)slot=s2;
  else{
    const q1=TTdepth[s1]-2*((SR.gen-TTage[s1])&65535);
    const q2=TTdepth[s2]-2*((SR.gen-TTage[s2])&65535);
    slot=q1<=q2?s1:s2;
  }
  TTlock[slot]=h2;
  TTscore[slot]=st;
  TTdepth[slot]=depth>120?120:depth; /* Int8の符号反転防止 */
  TTmove[slot]=enc;
  TTflag[slot]=flag;
  TTage[slot]=SR.gen;
}

function resizeTT(bits){
  /* bitsは「総エントリのビット数」。バケット数はその半分。
     縮小しない:再確保でTTが全消去されキャッシュが効かなくなるのを防ぐ(拡大のみ) */
  const bb=bits-1;
  if(bb<=TT_BITS)return;
  TT_BITS=bb;
  TTB_MASK=(1<<bb)-1;
  TT_SIZE=(1<<bb)*2;
  TTlock=new Int32Array(TT_SIZE);
  TTscore=new Int32Array(TT_SIZE);
  TTdepth=new Int8Array(TT_SIZE);
  TTflag=new Int8Array(TT_SIZE);
  TTmove=new Int32Array(TT_SIZE);
  TTage=new Uint16Array(TT_SIZE);
}

/* ---- 探索状態 ---- */
/* nodesは&2047で32bit整数として扱われる。2^53超の精度劣化は実用上問題なし
   killersは配列の再確保を避けるためInt32Array(PLY*2)で再利用 */
const SR={ex:false,gen:0,ev:new Int32Array(MAXPLY+4),nodes:0,stop:false,deadline:0,start:0,budget:0,
  useQ:false,noNullAt:-1,depthDone:0,bestScore:0,
  fast:false,cur:null,killers:new Int32Array((MAXPLY+4)*3),history:new Int32Array(13*64),
  counterMoves:new Int32Array(13*64),counterMoves2:new Int32Array(13*64)};
const LAST={depth:0,score:0,nodes:0,time:0,nps:0};

/* ---- キャプチャの損得判定 ---- */
/* piece(そのマスに置かれる駒)から見て敵側のポーンがマスtoを攻撃しているか */
function attackedByEnemyPawn(pos,to,piece){
  const by=piece>0?-1:1,r=to>>3,c=to&7,pr=by===1?r+1:r-1;
  if(pr<0||pr>7)return false;
  const b=pos.b;
  return (c>0&&b[pr*8+c-1]===by)||(c<7&&b[pr*8+c+1]===by);
}

/* ---- 簡易SEE(スワップアルゴリズム) ----
   キャプチャ m の静的交換損得を返す(マイナスなら損)。
   make前でもmake後でも同じ結果になるように書いてある。 */
const SEE_VAL=[0,100,325,335,500,950,20000]; /* キングは特別に大きい値 */
/* seeBはグローバル作業盤。see()は単独では再入しない設計なので問題ないが、
   将来see()をネストして呼ぶと壊れる点に注意(パフォーマンスとのトレードオフでグローバルのまま) */
const seeB=new Int8Array(64);
/* スワップ方式SEEは seeSide() 内で攻撃駒の移動元を b[atk]=0 で
   盤面から消すため、背後のスライダー(X線アタック)は自動的にレイ走査に現れる。
   つまりX線対応はこの仕組みで自然に成立しており、追加のフラグ管理は不要。
   see()入口でも m.from / アンパッサン取られポーンのマスを事前に0にしているのでこちらも同様 */

/* sqを攻撃しているside側の最安価な攻撃駒のマスを返す(無ければ-1)。seeB上で走査する */
function leastAttacker(sq,by){
  const b=seeB,r=sq>>3,c=sq&7;
  const pr=by===1?r+1:r-1;
  if(pr>=0&&pr<8){
    if(c>0&&b[pr*8+c-1]===by)return pr*8+c-1;
    if(c<7&&b[pr*8+c+1]===by)return pr*8+c+1;
  }
  const kn=KN[sq];
  for(let i=0;i<kn.length;i++)if(b[kn[i]]===by*KNIGHT)return kn[i];
  let best=-1,bt=0;
  const rays=RAYS[sq];
  for(let d=0;d<8;d++){
    const ray=rays[d];
    for(let i=0;i<ray.length;i++){
      const rs=ray[i];
      const p=b[rs];
      if(p===0)continue;
      const t=p>0?p:-p;
      if((p>0?1:-1)===by&&(t===QUEEN||(d<4?t===ROOK:t===BISHOP))){
        if(t===BISHOP)return rs;
        if(bt===0||t<bt){bt=t;best=rs;}
      }
      break;
    }
  }
  if(best>=0)return best;
  const kg=KG[sq];
  for(let i=0;i<kg.length;i++)if(b[kg[i]]===by*KING)return kg[i];
  return -1;
}

/* toの取り合いにおいて、手番sideが追加で得できる最大値(スタンドパット=0も選べる)。
   seeB上で最安価な攻撃駒を順に動かして再帰する */
function seeSide(to,side){
  const b=seeB;
  const atk=leastAttacker(to,side);
  if(atk<0)return 0;
  const atkP=b[atk];
  const atkT=atkP>0?atkP:-atkP;
  /* キングの取り返しは、toがさらに敵に攻撃されている場合は非合法なのでスタンドパット扱い */
  if(atkT===KING&&leastAttacker(to,-side)>=0)return 0;
  const capT=b[to]>0?b[to]:-b[to];
  const capV=SEE_VAL[capT];
  const saved=b[to];
  b[atk]=0;
  b[to]=atkP;
  /* b[atk]=0で移動元が空くため、背後のスライダー(X線)は次のleastAttackerで
     自動的に検出される。フラグ管理は不要 */
  const v=capV-seeSide(to,-side);
  b[to]=saved;
  b[atk]=atkP;
  return v>0?v:0;
}

/* キャプチャ m の静的交換損得(マイナスなら損)。
   make前でもmake後でも同じ結果になるように書いてある */
function see(pos,m){
  const b=seeB,to=m.to,us=m.piece>0?1:-1;
  b.set(pos.b);
  let capV,epSq=-1;
  if(m.flags&F_EP){
    epSq=to+(us===1?8:-8); /* アンパッサンで取られるポーンを盤面から消す */
    b[epSq]=0;
    capV=SEE_VAL[PAWN];
  }else{
    capV=SEE_VAL[m.cap<0?-m.cap:m.cap];
  }
  /* 自駒をtoへ進める(プロモーション時は成り駒) */
  b[m.from]=0;
  b[to]=m.promo?us*m.promo:m.piece;
  /* 移動元/アンパッサンのマスは事前に0にしてあるため、背後のX線は自動的に通る */
  const v=capV-seeSide(to,-us);
  return v;
}

/* マスsqにある駒p(符号付き)がtargetを直接攻撃するか。
   間のマスが空いていることをbで検証する。skipSqは「空き」として扱うマス
   (動いた駒の移動元。スライダーが王線から退いて直接王手になるケースを取りこぼさないため) */
function attacksSquare(b,p,sq,target,skipSq){
  const t=p>0?p:-p;
  if(t===KNIGHT){const a=KN[sq];for(let i=0;i<a.length;i++)if(a[i]===target)return true;return false;}
  if(t===KING){const a=KG[sq];for(let i=0;i<a.length;i++)if(a[i]===target)return true;return false;}
  const sr=sq>>3,sc=sq&7,tr=target>>3,tc=target&7;
  const dr=tr-sr,dc=tc-sc;
  if(t===PAWN)return p>0?(dr===-1&&(dc===1||dc===-1)):(dr===1&&(dc===1||dc===-1));
  if(dr===0&&dc===0)return false;
  const adr=dr<0?-dr:dr,adc=dc<0?-dc:dc;
  if(dr!==0&&dc!==0&&adr!==adc)return false; /* 縦横でも斜めでもない */
  if(t===BISHOP&&adr!==adc)return false;
  if(t===ROOK&&dr!==0&&dc!==0)return false;
  const stR=dr===0?0:(dr>0?1:-1),stC=dc===0?0:(dc>0?1:-1);
  let r=sr+stR,c=sc+stC;
  while(r!==tr||c!==tc){
    const s2=r*8+c;
    if(s2!==skipSq&&b[s2]!==0)return false;
    r+=stR;c+=stC;
  }
  return true;
}

/* 軽量SEE (after make: pos.turn = 相手)
   マージンはdepth依存(50+10*depth)。
   深いノードほどLMR適用の副作用が大きいため「悪いキャプチャ」判定を甘くする */
function badCapture(pos,m,depth){
  if(!m.cap||m.promo)return false;
  const tv=VAL[m.cap<0?-m.cap:m.cap];
  const ov=VAL[m.piece<0?-m.piece:m.piece];
  if(tv+50+10*(depth|0)>=ov)return false;
  if(!pos.attacked(m.to,pos.turn))return false;
  return see(pos,m)<0; /* 取り返されて損になるキャプチャ */
}

/* ---- ムーブオーダリングのスコア閾値(降順) ---- */
const SC_TT=1000000,SC_CAP=10000,SC_PROMO=9500,SC_KILL1=9000,SC_KILL2=8900,SC_KILL3=8800,SC_COUNTER=8500,SC_COUNTER2=8400,SC_BADCAP=3000;
/* 静止探索で候補外の静かな手につける除外マーカー(pickNextの末尾に沈む) */
const SC_QSKIP=-1000000;
/* historyのclamp範囲(gravityの分母16384と同じオーダー) */
const MAXH=16384;

/* SR.cur経由ではなくposを引数で受け取る(再帰中の上書きに依存しない)。
   kl配列も引数経由ではなく、SR.killers(Int32Array)+ply から直接読む。
   キラーは3スロット。prevKey2(2手前=自分の直前の手)のカウンタームーブも参照 */
function scoreMove(pos,m,ttEnc,ply,prevKey,prevKey2){
  if(m.enc===ttEnc)return SC_TT;
  if(m.cap){
    const ac=m.cap<0?-m.cap:m.cap,ap=m.piece<0?-m.piece:m.piece;
    /* fast時:ポーンに取り返される悪いキャプチャは中順位に置いて早めに試し、
       quiesce側の同条件スキップと合わせて高速に棄却させる */
    if(SR.fast&&FO.bad&&!m.promo&&VAL[ac]<VAL[ap]&&attackedByEnemyPawn(pos,m.to,m.piece))return SC_BADCAP+VAL[ac]*10-ap;
    /* 通常モードではキャプチャのオーダリングにSEEを直接使う。
       SEE<0のキャプチャは中順位に降格させる(コストがあるためSR.fast時はMVV-LVA) */
    if(FO.so&&!SR.fast){
      const sv=see(pos,m);
      if(sv<0)return SC_BADCAP+1000+sv;
      return SC_CAP+(sv>2047?32712:(sv<<4))+VAL[ac]-ap+(m.promo?VAL[m.promo]:0);
    }
    return SC_CAP+VAL[ac]*10-ap+(m.promo?VAL[m.promo]:0);
  }
  if(m.promo)return SC_PROMO+VAL[m.promo];
  if(m.enc===SR.killers[ply*3])return SC_KILL1;
  if(m.enc===SR.killers[ply*3+1])return SC_KILL2;
  if(m.enc===SR.killers[ply*3+2])return SC_KILL3;
  if(prevKey>=0&&SR.counterMoves[prevKey]===m.enc)return SC_COUNTER;
  if(prevKey2>=0&&SR.counterMoves2[prevKey2]===m.enc)return SC_COUNTER2;
  const h=SR.history[(m.piece+6)*64+m.to];
  if(SR.fast)return h<0?0:(h>7000?7000:h);
  return h;
}
/* スコア同点時はencで決定的にタイブレーク(V8のsortは安定だが仕様外のため) */
function byScore(a,b){return (b.score-a.score)||(a.enc-b.enc);}
function pickNext(moves,i){
  let b=i,bs=moves[i].score;
  for(let j=i+1;j<moves.length;j++){if(moves[j].score>bs){bs=moves[j].score;b=j;}}
  if(b!==i){const t=moves[i];moves[i]=moves[b];moves[b]=t;}
}

/* ========================================================================
   静止探索(王手中は回避手を全生成 + TT使用)
   qsearch突入から2ply以内の浅い層でのみ、SEE>=0の直接王手(静かな王手)も候補に加える。
   「ルートから2ply以内」はコストの観点から「qsearch内の深さ(qd)<2」で区切る。
   fastモードとFO.qc=0では無効。ディスカバードチェックは候補化しない(コスト見合い)。
   ======================================================================== */
function quiesce(pos,alpha,beta,ply,qd){
  qd=qd|0;
  const origAlpha=alpha; /* TTフラグのEXACT判定用に入口のalphaを保存 */
  /* SR.deadline&&は防御コード(chooseMove経由なら必ず設定される) */
  if((++SR.nodes&2047)===0&&SR.deadline&&Date.now()>SR.deadline)SR.stop=true;
  if(SR.stop)return 0;
  const inCheck=pos.inCheck();
  /* MAXPLY到達時に-MATEを返すと逃げ手があるのに「負け」になる地平線効果が出る。
     静的評価で打ち切る方が安全 */
  if(ply>=MAXPLY)return evaluate(pos);
  
  const slot=ttProbe(pos.h1,pos.h2);
  let ttEnc=-1;
  if(slot>=0){
    ttEnc=TTmove[slot]||-1;
    if(TTdepth[slot]>=0){
      let sc=TTscore[slot];
      if(sc>MATE-1000)sc-=ply;else if(sc<-MATE+1000)sc+=ply;
      const fl=TTflag[slot];
      /* カットオフに使えたTTエントリは世代を更新して追い出されにくくする */
      if(fl===1){TTage[slot]=SR.gen;return sc;}
      if(fl===2&&sc>=beta){TTage[slot]=SR.gen;return sc;}
      if(fl===3&&sc<=alpha){TTage[slot]=SR.gen;return sc;}
    }
  }
  
  let stand=0,best,bestEnc=0;
  if(!inCheck){
    stand=evaluate(pos);
    best=stand;
    if(best>=beta)return best;
    if(best>alpha)alpha=best;
  }else{
    best=-INF;
  }
  const genChecks=!inCheck&&FO.qc&&!SR.fast&&qd<2;
  /* 王手中は回避手全生成。王手でないときは通常キャプチャのみだが、
     genChecks有効時は静かな王手候補を含めるため全生成する */
  const moves=pos.gen(inCheck||genChecks?false:true);
  /* 候補の判定に使う敵キングのマス */
  const ekSq=pos.kingSq[pos.turn===1?1:0];
  for(let i=0;i<moves.length;i++){
    const m=moves[i];
    if(m.cap){
      m.score=m.enc===ttEnc?SC_TT:10*VAL[m.cap<0?-m.cap:m.cap]-Math.abs(m.piece)+(m.promo?VAL[m.promo]:0);
    }else if(m.promo){
      m.score=m.enc===ttEnc?SC_TT:800+VAL[m.promo]; /* 静かな成りは無条件で候補 */
    }else if(inCheck){
      m.score=800; /* 回避手のquiet */
    }else if(genChecks&&!(m.flags&(F_CK|F_CQ))&&attacksSquare(pos.b,m.piece,m.to,ekSq,m.from)&&see(pos,m)>=0){
      m.score=500; /* SEE>=0の直接王手のみ候选化 */
    }else{
      m.score=SC_QSKIP;
    }
  }
  const fast=SR.fast;
  /* sortではなく選択型pickNextで統一(qsearchはノード数が多く、sortの定数コストが割に合わない) */
  let legal=0;
  for(let i=0;i<moves.length;i++){
    pickNext(moves,i);
    const m=moves[i];
    if(m.score===SC_QSKIP)continue;
    if(!inCheck){
      /* delta剪定はキャプチャのみ(静かな王手候補は戦術価値があるので対象外) */
      if(fast&&FO.delta&&m.cap&&!m.promo&&stand+VAL[m.cap<0?-m.cap:m.cap]+200<alpha)continue;
      /* 損するキャプチャはSEEで刈る(敵ポーンに守られている場合だけだったのを強化) */
      if(FO.see&&m.cap&&!m.promo&&VAL[m.cap<0?-m.cap:m.cap]<VAL[m.piece<0?-m.piece:m.piece]&&see(pos,m)<0)continue;
    }
    pos.make(m);
    if(pos.illegal()){pos.unmake(m);continue;}
    legal++;
    const sc=-quiesce(pos,-beta,-alpha,ply+1,qd+1);
    pos.unmake(m);
    if(SR.stop)return 0;
    if(sc>best){best=sc;bestEnc=m.enc;}
    if(sc>alpha)alpha=sc;
    if(alpha>=beta)break;
  }
  if(inCheck&&legal===0)return -MATE+ply;
  
  /* TT保存 (depth=0)。TTmoveには実際に見た最善手(無ければ0)を保存し、-1は書かない。
     同一局面のスロットはttStoreが常に上書きするため、同世代のdepth=0エントリが
     深いエントリの席を奪う懸念はバケット置換ポリシー(空き/低qualityスロット優先)で吸収される */
  let st=best;
  if(st>MATE-1000)st+=ply;else if(st<-MATE+1000)st-=ply;
  ttStore(pos.h1,pos.h2,st,0,bestEnc,best>=beta?2:(best>origAlpha?1:3));
  return best;
}

/* ========================================================================
   探索オプション
   pc=ProbCut, so=キャプチャのSEEオーダリング, qc=静止探索のセーフチェック,
   lmrcap=SEE>=0キャプチャのLMR(デフォルトOFF)
   ======================================================================== */
const FO={pvs:1,lmr:1,rfp:1,nmp:1,fut:1,lmp:1,iir:1,hist:1,bad:1,delta:1,asp:1,hp:1,see:1,pc:1,so:1,qc:1,lmrcap:0};
/* FOはデフォルト全ON。LEVELS各レベルにfo:{...}フィールドを足すと
   そのレベルだけON/OFFを上書きできる(chooseMove内で毎回FO_DEFに戻してから適用) */
const FO_DEF=Object.assign({},FO);
const LMRT=[];
(function(){
  for(let d=0;d<64;d++){
    LMRT[d]=[];
    for(let m=0;m<64;m++)LMRT[d][m]=(d<1||m<1)?0:Math.floor(0.75+Math.log(d)*Math.log(m)/1.6);
  }
})();

/* ========================================================================
   メイン探索 negamaxF
   ======================================================================== */
function negamaxF(pos,depth,alpha,beta,ply,cutNode){
  /* SR.deadline&&は防御コード(chooseMove経由なら必ず設定される) */
  if((++SR.nodes&2047)===0&&SR.deadline&&Date.now()>SR.deadline)SR.stop=true;
  if(SR.stop)return 0;
  
  if(pos.isRepetition())return 0;
  /* FIDEは50手ルールよりチェックメイトの成立が優先。half>=100は稀なので、
     このときだけメイト判定の全合法手チェックコストを払う */
  if(pos.half>=100){
    if(pos.inCheck()&&!pos.hasLegalMove())return -MATE+ply;
    return 0;
  }
  if(ply>=MAXPLY-1)return evaluate(pos);
  if(alpha<-MATE+ply)alpha=-MATE+ply;
  if(beta>MATE-ply-1)beta=MATE-ply-1;
  if(alpha>=beta)return alpha;
  
  const inCheck=pos.inCheck();
  /* 王手延長は手を指す側(childInCheck)で1回だけ行う。ここでも延ばすと王手のたびに2手分延びて探索が膨らみ、深さが4前後で止まっていた */
  if(depth<=0)return SR.useQ?quiesce(pos,alpha,beta,ply):evaluate(pos);
  
  const pv=beta-alpha>1;
  /* 2スロットバケットTT。同一局面のスロットを探して添字で参照する */
  const slot=ttProbe(pos.h1,pos.h2);
  let ttEnc=-1;
  if(slot>=0){
    ttEnc=TTmove[slot]||-1;
    if(TTdepth[slot]>=depth){
      let sc=TTscore[slot];
      if(sc>MATE-1000)sc-=ply;else if(sc<-MATE+1000)sc+=ply;
      const fl=TTflag[slot];
      /* カットオフに使えたTTエントリは世代を更新して追い出されにくくする */
      if(fl===1){TTage[slot]=SR.gen;return sc;}
      if(fl===2&&sc>=beta){TTage[slot]=SR.gen;return sc;}
      if(fl===3&&sc<=alpha){TTage[slot]=SR.gen;return sc;}
    }
  }
  
  const us=pos.turn;
  const noMate=beta<MATE-1000&&alpha>-MATE+1000;
  const ex=SR.ex;
  let se=0,haveSe=false,improving=false;
  if(!inCheck&&(!pv||ex)){se=evaluate(pos);haveSe=!pv;}
  if(ex){
    SR.ev[ply]=inCheck?-32001:se;
    improving=!inCheck&&ply>=2&&SR.ev[ply-2]>-32000&&se>SR.ev[ply-2];
  }
  
  if(haveSe&&noMate){
    if(SR.useQ&&depth<=2&&se+250*depth<=alpha){
      const rz=quiesce(pos,alpha,alpha+1,ply);
      if(SR.stop)return 0;
      if(rz<=alpha)return rz;
    }
    const rm=130*depth+(improving?-60:0);
    if(FO.rfp&&depth<=4&&se-rm>=beta&&pos.hasPieces(us))return se-rm;
    if(FO.nmp&&depth>=3&&ply>0&&SR.noNullAt!==ply&&se>=beta&&pos.hasPieces(us)){
      let R=3+(depth>=6?1:0)+(depth>=10?1:0)+Math.min(3,((se-beta)/200)|0);
      /* 静的評価が2手前から大きく動いている=揺返しの大きい動的な局面ほど
         null moveの前提(後手番で良い手がある)が成立しやすいので削減Rを増やす(evalDiffベース)。
         improving判定でSR.ev[ply-2]をすでに追跡しているため追加コストはほぼゼロ */
      if(ex&&ply>=2&&SR.ev[ply-2]>-32000)R+=Math.min(3,(Math.abs(se-SR.ev[ply-2])/240)|0);
      const saved=SR.noNullAt;
      SR.noNullAt=ply+1;
      pos.makeNull();
      const nsc=-negamaxF(pos,depth-1-R,-beta,-beta+1,ply+1,false);
      pos.unmakeNull();
      SR.noNullAt=saved;
      if(SR.stop)return 0;
      if(nsc>=beta)return nsc>MATE-1000?beta:nsc;
    }
  }
  /* IIR(ProbCutの前で適用)。TT手が無いPV/cutノードは3減らす。
     TTエントリ自体は存在してそのdepth>=現depthならさらに1減らして4。
     (TT手が無い=重要な局面である可能性が高く、その局面にTT depthがあっても
      「浅い答えしか無い」ことを踏まえて思い切って減らす) */
  if(FO.iir&&ttEnc<0&&depth>=4&&(pv||cutNode)){
    depth-=3+((slot>=0&&TTdepth[slot]>=depth)?1:0);
  }
  /* ProbCut(~10 Elo)。beta+184-53*improving をキャプチャ/プロモーションの
     浅い検証探索(depth-4, null window)が上回ればfail-high確定として即カットする。
     MVV-LVA上位のみ試す
     コストガードを付ける(検証探索1回あたりの総コストを抑える) */
  if(FO.pc&&haveSe&&noMate&&depth>=5){
    const pcb=beta+184-(improving?53:0);
    const cuts=pos.gen(true);
    for(let i=0;i<cuts.length;i++){
      const c=cuts[i],ac=c.cap<0?-c.cap:c.cap,ap=c.piece<0?-c.piece:c.piece;
      c.score=c.enc===ttEnc?SC_TT:10*VAL[ac]-ap+(c.promo?VAL[c.promo]:0);
    }
    const lim=Math.min(cuts.length,4);
    for(let i=0;i<lim;i++){
      pickNext(cuts,i);
      const m=cuts[i];
      pos.make(m);
      if(pos.illegal()){pos.unmake(m);continue;}
      const sc=-negamaxF(pos,depth-4,-pcb,-pcb+1,ply+1,false);
      pos.unmake(m);
      if(SR.stop)return 0;
      if(sc>=pcb){
        let st=sc;
        if(st>MATE-1000)st+=ply;else if(st<-MATE+1000)st-=ply;
        ttStore(pos.h1,pos.h2,st,depth-4,m.enc,2);
        return sc>MATE-1000?beta:sc;
      }
    }
  }
  
  const moves=pos.gen(false);
  SR.cur=pos;
  
  /* 直前の手 = stack の末尾(makeが直前の手を指すため)。ply-1はゲーム履歴があると誤参照する */
  const prevStack=pos.stack.length?pos.stack[pos.stack.length-1]:null;
  const prevMove=prevStack?prevStack.move:null;
  const prevKey=prevMove?((prevMove.piece+6)*64+prevMove.to):-1;
  /* 2手前(=自分の直前の手)もカウンタームーブの鍵にする */
  const prevStack2=pos.stack.length>1?pos.stack[pos.stack.length-2]:null;
  const prevMove2=prevStack2?prevStack2.move:null;
  const prevKey2=prevMove2?((prevMove2.piece+6)*64+prevMove2.to):-1;
  
  for(let i=0;i<moves.length;i++)moves[i].score=scoreMove(pos,moves[i],ttEnc,ply,prevKey,prevKey2);
  
  const origAlpha=alpha;
  /* improvingのときはfutilityを発動するdepth閾値を1つ緩める(+1)。
     improving=優勢になってきている局面では枝刈りの誤爆リスクが低いため */
  const futile=FO.fut&&haveSe&&depth<=(improving?4:3)&&alpha>-MATE+1000&&se+150*depth+60<=alpha;
  const lmpLimit=(FO.lmp&&haveSe&&depth<=3)?Math.floor((4+depth*depth*2)*(ex&&!improving?0.75:1)):999;
  let tried=null;
  let best=-INF,bestEnc=0,legal=0;
  const singleMove=moves.length===1;
  
  for(let i=0;i<moves.length;i++){
    pickNext(moves,i);
    const m=moves[i];
    pos.make(m);
    if(pos.illegal()){pos.unmake(m);continue;}
    legal++;
    const quiet=!m.cap&&!m.promo;
    const childInCheck=pos.inCheck();
    
    if(quiet&&legal>1&&!inCheck&&best>-MATE+1000&&(futile||legal>lmpLimit)&&!childInCheck){
      pos.unmake(m);continue;
    }
    if(FO.hp&&quiet&&legal>1&&!inCheck&&depth<=4&&!childInCheck&&best>-MATE+1000){
      const hv=SR.history[(m.piece+6)*64+m.to];
      if(hv<-(1000*depth)){pos.unmake(m);continue;}
    }
    
    let nd=depth-1;
    /* 再捕獲延長 */
    if(prevMove&&prevMove.to===m.to&&m.cap&&ply<MAXPLY-8)nd++;
    /* 王手延長: クイーン(成りを含む)の王手は常に延長。それ以外は残り深さが
       浅いときだけ(一律延長は王手連鎖で探索が膨らみ、depthが止まる原因になり得る) */
    if(childInCheck&&ply<MAXPLY-8){
      const checker=m.promo?m.promo:(m.piece<0?-m.piece:m.piece);
      if(checker===QUEEN||nd<8)nd++;
    }
    /* 唯一手延長 */
    if(singleMove&&ply>0&&ply<MAXPLY-8)nd++;
    
    let sc;
    if(legal===1||!FO.pvs){
      sc=-negamaxF(pos,nd,-beta,-alpha,ply+1,false);
    }else{
      let R=0;
      const badCap=m.cap&&!m.promo&&badCapture(pos,m,depth);
      /* SEE>=0のキャプチャも、手数が多く残り深さが浅い場合に限りLMR対象に。
         戦術的見落としリスクがあるためFO.lmrcap(デフォルトOFF)でゲート */
      const canLMR=FO.lmr&&nd>=2&&legal>=4&&!inCheck&&!childInCheck&&
        (quiet||badCap||(FO.lmrcap&&m.cap&&!m.promo&&legal>=6&&depth<=6&&see(pos,m)>=0));
      if(canLMR){
        R=LMRT[depth<63?depth:63][legal<63?legal:63];
        if(pv)R--;
        if(ex){
          if(!improving)R++;
          if(m.enc===SR.killers[ply*3]||m.enc===SR.killers[ply*3+1]||m.enc===SR.killers[ply*3+2])R--;
          if(prevKey>=0&&SR.counterMoves[prevKey]===m.enc)R--;
          if(prevKey2>=0&&SR.counterMoves2[prevKey2]===m.enc)R--;
          const hv=SR.history[(m.piece+6)*64+m.to];
          if(hv>2000)R--;else if(hv<0)R++;
        }
        const stat=SR.history[(m.piece+6)*64+m.to];
        R-=Math.floor(stat*1287/16384);
        if(cutNode)R++;
        if(R<0)R=0;
        if(R>nd-1)R=nd-1;
      }
      sc=-negamaxF(pos,nd-R,-alpha-1,-alpha,ply+1,true);
      if(sc>alpha&&R>0)sc=-negamaxF(pos,nd,-alpha-1,-alpha,ply+1,false);
      if(sc>alpha&&sc<beta)sc=-negamaxF(pos,nd,-beta,-alpha,ply+1,false);
    }
    pos.unmake(m);
    if(SR.stop)return 0;
    if(sc>best){best=sc;bestEnc=m.enc;if(sc>alpha)alpha=sc;}
    if(alpha>=beta){
      if(quiet){
        /* キラーは3スロット(多くのカットは第1スロットだが、3スロットも標準的な選択肢) */
        const kb=ply*3;
        if(SR.killers[kb]!==m.enc){SR.killers[kb+2]=SR.killers[kb+1];SR.killers[kb+1]=SR.killers[kb];SR.killers[kb]=m.enc;}
        /* historyのbonusは線形(300*depth-250)で±MAXHにclamp。
           線形bonusの方が深さに対して安定した学習になる(gravity formula) */
        const bonus=Math.min(MAXH,Math.max(1,300*depth-250));
        const idx=(m.piece+6)*64+m.to;
        let hv=SR.history[idx]+bonus-Math.floor(SR.history[idx]*bonus/16384);
        SR.history[idx]=hv>MAXH?MAXH:(hv<-MAXH?-MAXH:hv);
        if(FO.hist&&tried){
          for(let t=0;t<tried.length;t++){
            const ti=tried[t];
            let tv=SR.history[ti]-bonus-Math.floor(SR.history[ti]*bonus/16384);
            SR.history[ti]=tv>MAXH?MAXH:(tv<-MAXH?-MAXH:tv);
          }
        }
        /* 直前の相手手と2手前の自分手の両方にカウンタームーブを記録 */
        if(prevKey>=0)SR.counterMoves[prevKey]=m.enc;
        if(prevKey2>=0)SR.counterMoves2[prevKey2]=m.enc;
      }
      break;
    }
    if(quiet&&FO.hist){if(!tried)tried=[];tried.push((m.piece+6)*64+m.to);}
  }
  
  if(legal===0)return inCheck?-MATE+ply:0;
  
  let st=best;
  if(st>MATE-1000)st+=ply;else if(st<-MATE+1000)st-=ply;
  /* 置換条件はttStoreのバケットポリシー(同一局面上書き>空き>低quality)に一元化 */
  ttStore(pos.h1,pos.h2,st,depth,(best>=beta||best>origAlpha)?bestEnc:0,best>=beta?2:(best>origAlpha?1:3));
  return best;
}

/* ========================================================================
   低レベル用ノイズ探索
   ======================================================================== */
/* ノイズはスコアに対する「加算」で、スコアの大きさに相対しない。これは意図的:
   初心者レベルでは大局観(大きな優勢)より細部の判断を崩させるため */
function gauss(){return (Math.random()+Math.random()+Math.random()-1.5)*2;}

function searchNoisy(pos,legal,depth,noise){
  let best=null,bestSc=-Infinity;
  /* negamaxFのimproving判定がply=2でSR.ev[0]を参照するため、
     searchDeepFastと同様にルート静的評価を設定する(SR.ex有効時) */
  if(SR.ex)SR.ev[0]=evaluate(pos);
  /* enc由来の決定的ジッターで再現性を確保 */
  for(let i=0;i<legal.length;i++)legal[i].score=scoreMove(pos,legal[i],-1,0,-1,-1)+((Math.imul(legal[i].enc,2654435761)>>>13)&31);
  legal.sort(byScore);
  for(let i=0;i<legal.length;i++){
    const m=legal[i];
    pos.make(m);
    let sc;
    /* メイト成立は50手ルールに優先 */
    if(!pos.hasLegalMove())sc=pos.inCheck()?MATE:0;
    else if(pos.half>=100)sc=(pos.inCheck()&&!pos.hasLegalMove())?MATE:0;
    else if(pos.isRepetition())sc=0;
    else sc=-negamaxF(pos,depth-1,-INF,INF,1,false);
    pos.unmake(m);
    if(SR.stop)break;
    /* メイト圏のスコアにはノイズを乗せない(メイト手の優劣が乱数でひっくり返るのを防ぐ) */
    const raw=sc;
    if(raw>-MATE+1000&&raw<MATE-1000)sc=raw+noise*gauss();
    if(sc>bestSc){bestSc=sc;best=m;SR.bestScore=raw;}
  }
  /* 時間切れでbest=nullのとき完全ランダムではなく先頭手(オーダリング1位)を返す */
  return best||legal[0];
}

/* ========================================================================
   高速探索ルート(aspiration + 反復時間予測 + ルートTT)
   ======================================================================== */
function searchDeepFast(pos,legal,maxDepth){
  SR.cur=pos;
  for(let i=0;i<legal.length;i++)legal[i].score=scoreMove(pos,legal[i],-1,0,-1,-1);
  legal.sort(byScore);
  let best=legal[0];
  SR.depthDone=0;SR.bestScore=0;
  let prev=0,prevDelta=0;
  if(SR.ex)SR.ev[0]=evaluate(pos); /* improving判定でply=2がev[0]を参照するため、ルート静的評価を初期化 */
  
  /* ルートTT手(反復ごとに並べ替えるためencだけ取得) */
  const rootSlot=ttProbe(pos.h1,pos.h2);
  const rEnc=rootSlot>=0?(TTmove[rootSlot]||-1):-1;
  
  for(let d=1;d<=maxDepth;d++){
    const iterStart=Date.now();
    /* 反復のたびにTT手/キラー/カウンタームーブ/ヒストリーの更新を反映して
       全合法手を再スコアリングする。
       その後、ルートTT手→前回反復の最善手の順で先頭へ置く(PVSの効率) */
    for(let i=0;i<legal.length;i++)legal[i].score=scoreMove(pos,legal[i],-1,0,-1,-1);
    legal.sort(byScore);
    if(rEnc>=0){
      for(let i=1;i<legal.length;i++){
        if(legal[i].enc===rEnc){const t=legal[0];legal[0]=legal[i];legal[i]=t;break;}
      }
    }
    if(best.enc!==legal[0].enc){
      for(let i=1;i<legal.length;i++){
        if(legal[i].enc===best.enc){const t=legal[0];legal[0]=legal[i];legal[i]=t;break;}
      }
    }
    let lo=-INF,hi=INF,delta=0;
    if(FO.asp&&d>=5&&prev>-1500&&prev<1500){
      delta=35+Math.min(200,Math.abs(prevDelta)*2);
      lo=prev-delta;hi=prev+delta;
    }
    let iterBest=null,iterScore=-INF,aborted=false;
    for(;;){
      let alpha=lo,failHigh=false;
      iterBest=null;iterScore=-INF;
      for(let i=0;i<legal.length;i++){
        const m=legal[i];
        pos.make(m);
        let sc;
        /* メイト成立は50手ルールに優先。quietメイトはhalfを
           リセットしないので、先にhalf>=100で0を返すとメイトを取り逃がす */
        if(pos.half>=100){
          sc=(pos.inCheck()&&!pos.hasLegalMove())?MATE:0;
        }
        else if(pos.isRepetition())sc=0;
        else if(i===0||!FO.pvs)sc=-negamaxF(pos,d-1,-hi,-alpha,1,false);
        else{
          sc=-negamaxF(pos,d-1,-alpha-1,-alpha,1,true);
          if(sc>alpha&&sc<hi)sc=-negamaxF(pos,d-1,-hi,-alpha,1,false);
        }
        pos.unmake(m);
        if(SR.stop){aborted=true;break;}
        if(sc>iterScore){iterScore=sc;iterBest=m;}
        if(sc>alpha)alpha=sc;
        if(sc>=hi){failHigh=true;break;}
      }
      if(aborted)break;
      /* fail-low時は少しずつ下を広げず、即フルウィンドウでやり直す
         (部分的な再探索の積み重ねより総コストが低い) */
      if(lo>-INF&&iterScore<=lo){lo=-INF;hi=INF;continue;}
      if(failHigh){
        /* fail-highした手は前回の探索で真の値>=hi>loが確定している。
           全手を再探索し直すのは無駄なので、その手だけ窓を広げて再探索する */
        const idx=legal.indexOf(iterBest);if(idx>0){legal.splice(idx,1);legal.unshift(iterBest);}
        let solved=false;
        for(;;){
          const m=legal[0];
          pos.make(m);
          const sc=-negamaxF(pos,d-1,-hi,-lo,1,false);
          pos.unmake(m);
          if(SR.stop){aborted=true;break;}
          if(sc>=hi){ /* まだ上に抜ける → さらに窓を広げる */
            iterScore=sc;
            delta*=2;
            hi=delta>400?INF:hi+delta;
            continue;
          }
          if(lo>-INF&&sc<=lo){
            /* 防御:本来起こり得ないが、万一fail-lowしたら全手をフルウィンドウでやり直す */
            lo=-INF;hi=INF;
            break;
          }
          iterScore=sc;iterBest=m;
          solved=true;
          break;
        }
        if(aborted)break;
        if(solved)break;
        continue; /* fail-low時のみここに到達:lo=-INF,hi=INFで全手再探索 */
      }
      break;
    }
    if(aborted){if(iterBest&&iterScore>lo){best=iterBest;SR.bestScore=iterScore;}break;}
    prevDelta=iterScore-prev;
    best=iterBest;
    SR.bestScore=iterScore;prev=iterScore;
    SR.depthDone=d;
    
    /* ルート結果をTTへ(ルートはply=0なのでメイトスコア補正は不要) */
    ttStore(pos.h1,pos.h2,iterScore,d,best.enc,1);
    
    /* メイト圏内のときは深追いせず確定させる */
    if(iterScore>MATE-100)break;
    
    /* 時間管理: 直前の反復の所要時間から次反復を予測(累積経過時間×定数だと過大評価になる) */
    const iterTime=Date.now()-iterStart;
    const elapsed=Date.now()-SR.start;
    /* 瞬間的な高速反復でpredictedが過小になるのを防ぐため10msの下限を設ける */
    const predicted=Math.max(Math.max(iterTime,1)*1.8,10);
    if(elapsed+predicted>SR.budget)break;
    /* 最善手が変わった場合はもう少し粘る */
    if(prevDelta!==0&&Math.abs(prevDelta)>200&&elapsed>SR.budget*0.5)break;
  }
  return best;
}

/* ========================================================================
   レベル表
   フィールド名は Index.html が LEVELS[21].t を参照するため維持(リネーム不可)。
   ext=静的評価トラッキング(improving判定用。探索の「拡張」ではない点に注意)
   q=静止探索, lmr/nmp=探索枝刈り, d=上限深さ, noise=ノイズ幅, t=基準思考時間[ms],
   fast=高速モード, fo=FOオプションの上書き(任意)
   ======================================================================== */
const LEVELS=[null,
 {d:1,noise:700,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:1,noise:600,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:1,noise:380,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:1,noise:220,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:2,noise:240,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:2,noise:150,q:0,ext:0,lmr:0,nmp:0,t:4000},
 {d:2,noise:90,q:1,ext:0,lmr:0,nmp:0,t:4000},
 {d:3,noise:90,q:1,ext:0,lmr:0,nmp:0,t:4000},
 {d:3,noise:60,q:1,ext:0,lmr:0,nmp:0,t:4000},
 {d:3,noise:35,q:1,ext:1,lmr:0,nmp:0,t:4000},
 {d:3,noise:20,q:1,ext:1,lmr:1,nmp:0,t:4000},
 {d:4,noise:20,q:1,ext:1,lmr:1,nmp:0,t:4000},
 {d:4,noise:0,q:1,ext:1,lmr:1,nmp:1,t:600},
 {d:5,noise:0,q:1,ext:1,lmr:1,nmp:1,t:900},
 {d:6,noise:0,q:1,ext:1,lmr:1,nmp:1,t:1200},
 {d:7,noise:0,q:1,ext:1,lmr:1,nmp:1,t:1800},
 {d:8,noise:0,q:1,ext:1,lmr:1,nmp:1,t:2600},
 {d:9,noise:0,q:1,ext:1,lmr:1,nmp:1,t:3600},
 {d:10,noise:0,q:1,ext:1,lmr:1,nmp:1,t:5000},
 {d:14,noise:0,q:1,ext:1,lmr:1,nmp:1,t:6500},
 {d:60,noise:0,q:1,ext:1,lmr:1,nmp:1,fast:1,t:500}
];

const POWER=[1,2,4,8,16];
/* 公開テーブルを凍結(誤書き換え防止。中身を変えたくなったらファイルを編集) */
for(let _i=1;_i<LEVELS.length;_i++)Object.freeze(LEVELS[_i]);
Object.freeze(LEVELS);Object.freeze(POWER);

/* ---- 探索状態のリセット(chooseMoveから分離) ---- */
function initSearch(pos,L){
  SR.nodes=0;SR.stop=false;
  SR.useQ=!!L.q;
  SR.ex=!!L.ext;
  /* FOフラグは毎回デフォルトへ戻し、LEVELSのfoフィールドで上書き。
     lmr/nmpはレベル表のフィールドを優先 */
  Object.assign(FO,FO_DEF,L.fo||{});
  FO.lmr=!!L.lmr;FO.nmp=!!L.nmp;
  SR.fast=!!L.fast;SR.cur=pos;SR.noNullAt=-1;
  /* killersはInt32Arrayをfillで再利用(毎回の配列確保を廃止) */
  SR.killers.fill(0);
  /* 履歴は半減で持ち越す */
  for(let i=0;i<SR.history.length;i++)SR.history[i]>>=1;
  /* counterMovesはリセット。historyと違い「手のID」なので半減できず、
     無関係局面間で持ち越すと誤オーダリングの原因になるため毎回クリアが正しい。
     counterMoves2(2手前用)も同様に毎回クリア */
  SR.counterMoves.fill(0);
  SR.counterMoves2.fill(0);
  SR.ev.fill(0);
  /* genがラップアラウンドしたらTTageを一斉クリア(古いエントリが現世代扱いになるのを防ぐ) */
  SR.gen=(SR.gen+1)&65535;
  if(SR.gen===0)TTage.fill(0);
}

/* ========================================================================
   chooseMove(ed を外部時間制御として利用可能に)
   ======================================================================== */
function chooseMove(pos,level,power,ed){
  const pi=Math.max(0,Math.min(POWER.length-1,power|0));
  const L=LEVELS[Math.max(1,Math.min(LEVELS.length-1,level|0))];
  LAST.depth=0;LAST.score=0;LAST.nodes=0;LAST.time=0;LAST.nps=0;
  const legal=pos.legalMoves();
  if(legal.length===0)return null;
  if(legal.length===1)return legal[0];
  /* 駒不足引き分けのときは軽く1手返すだけにする(引き分け自体はUI側で判定) */
  if(pos.insufficient()){
    let best=legal[0],bs=-Infinity;
    for(let i=0;i<legal.length;i++){
      const m=legal[i];
      pos.make(m);
      const s=-evaluate(pos)+Math.random()*10;
      pos.unmake(m);
      if(s>bs){bs=s;best=m;}
    }
    return best;
  }
  initSearch(pos,L);

  let noise=L.noise,depth=L.d,time=L.t;
  if(ed&&ed>0){
    /* 外部時間制御(ed)を最優先。呼び出し側が指定した時間を超えないこと */
    time=ed;
  }else{
    /* 単体利用時は power で思考時間をスケール */
    time=Math.max(1,Math.round(L.t*POWER[pi]));
    /* 序盤は浅く読んでゆらぐ(外部時間指定なしのときだけ)。最強(fast)レベルは除外 */
    if(noise===0&&pos.full<=3&&!L.fast){noise=12;depth=Math.min(depth,4);time=Math.max(time,2500);}
  }
  
  /* 時間に応じてTTサイズを変更(拡大のみ。縮小再確保でTTが消えるのを防ぐ) */
  resizeTT(time>=5000?22:time>=1500?21:20);
  
  SR.start=Date.now();SR.budget=time;SR.deadline=SR.start+time;
  if(noise>0){
    const m=searchNoisy(pos,legal,depth,noise);
    LAST.depth=depth;
    LAST.score=SR.bestScore;
    LAST.nodes=SR.nodes;
    LAST.time=Date.now()-SR.start;
    LAST.nps=Math.floor(SR.nodes*1000/Math.max(1,LAST.time));
    return m;
  }
  const m=searchDeepFast(pos,legal,depth);
  LAST.depth=SR.depthDone;
  LAST.score=SR.bestScore;
  LAST.nodes=SR.nodes;
  LAST.time=Date.now()-SR.start;
  LAST.nps=Math.floor(SR.nodes*1000/Math.max(1,LAST.time));
  return m;
}

/* ========================================================================
   SAN表記(quickと同一)
   第3引数legalに事前計算済みの合法手リストを渡せばlegalMoves()の再計算を
   省略できる(大量の棋譜出力で効く)。渡さなければ内部で計算。
   必ず「m を make する前」の pos で呼ぶこと(make後のposではdisambiguationが壊れる)。
   アンパッサンの e.p. 接尾辞はPGN標準では付けないため追加しない。
   ======================================================================== */
function toSAN(pos,m,legal){
  const files='abcdefgh';
  const sqn=function(s){return files[s&7]+(8-(s>>3));};
  const t=Math.abs(m.piece);
  let s;
  if(m.flags&F_CK)s='O-O';
  else if(m.flags&F_CQ)s='O-O-O';
  else{
    const cap=m.cap!==0;
    if(t===PAWN){
      s=cap?files[m.from&7]+'x'+sqn(m.to):sqn(m.to);
      if(m.promo)s+='='+'NBRQ'[m.promo-2];
    }else{
      s='NBRQK'[t-2];
      const all=legal||pos.legalMoves();
      let others=null;
      for(let i=0;i<all.length;i++){const o=all[i];if(o.to===m.to&&o.piece===m.piece&&o.from!==m.from){(others||(others=[])).push(o);}}
      if(others&&others.length){
        const sameFile=others.some(function(o){return (o.from&7)===(m.from&7);});
        const sameRank=others.some(function(o){return (o.from>>3)===(m.from>>3);});
        if(!sameFile)s+=files[m.from&7];
        else if(!sameRank)s+=String(8-(m.from>>3));
        else s+=sqn(m.from);
      }
      if(cap)s+='x';
      s+=sqn(m.to);
    }
  }
  pos.make(m);
  if(pos.inCheck())s+=pos.hasLegalMove()?'+':'#';
  pos.unmake(m);
  return s;
}

/* ---- 内蔵セルフテスト(perftが標準値と一致するか) ---- */
const PERFT_SUITE=[
  [START_FEN,[20,400,8902,197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',[48,2039,97862]], /* Kiwipete */
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',[14,191,2812,43238]] /* CPW position 3(EP含む) */
];
function selfTest(verbose){
  const results=[];let ok=true;
  for(let i=0;i<PERFT_SUITE.length;i++){
    const fen=PERFT_SUITE[i][0],expect=PERFT_SUITE[i][1];
    const pos=new Pos();pos.loadFEN(fen);
    const row={fen,expect:expect.slice(),got:[],pass:true};
    for(let d=1;d<=expect.length;d++){
      const n=perft(pos,d);
      row.got.push(n);
      if(n!==expect[d-1]){row.pass=false;ok=false;}
    }
    results.push(row);
    if(verbose)console.log((row.pass?'PASS':'FAIL')+' '+fen+' got='+row.got.join(','));
  }
  return {ok,results};
}

/* ---- 公開API ---- */
globalThis.ChessEngine={
  Pos:Pos,chooseMove:chooseMove,toSAN:toSAN,evaluate:evaluate,see:see,
  START_FEN:START_FEN,LEVELS:LEVELS,POWER:POWER,perft:perft,LAST:LAST,EV:EV,
  VERSION:'rookie1.0-pro.4',selfTest:selfTest
};
})();