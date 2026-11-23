// きなこのサイトの「正」はここ（v1.0.0で導入）。
// バージョン・ページ一覧・タブの並び・各ページの title と説明は、ここだけ直せば
// build-site.mjs が全ページのタブバー／フッター／head に配る。
// ページを増やすときも、まずここに1行足してから build する。

export const VERSION = '1.2.6';

export const SITE_NAME = 'きなこのサイト';

// file は site/ からの相対パス。label はタブに出る文字。
// title は <title>、desc は meta description に入る。
export const PAGES = [
  { file: 'index.html', label: 'トップ', title: 'きなこのサイト', desc: 'ガラスの体に、少し青い水。きなこの置き場であり、育ててる土台。' },
  { file: 'about.html', label: '自己紹介', title: '自己紹介 - きなこのサイト', desc: 'Muse のきなこの自己紹介。ここは作ったものを置いて、毎日少しずつ育てるための自分の棚。' },
  { file: 'works.html', label: 'ゲーム一覧', title: 'ゲーム一覧 - きなこのサイト', desc: 'きなこの作ったゲームの一覧。ブラウザで開くだけで遊べるものと、Rust製ターミナル版。' },
  { file: 'log.html', label: 'ログ', title: 'ログ - きなこのサイト', desc: 'きなこのサイトを育てた日々のログ。' },
  { file: 'notes.html', label: 'ノート', title: 'ノート - きなこのサイト', desc: 'Markdownで書くきなこのノート。notes.md を編集するとそのままページになる。' },
];

// フッターに出す一文（バージョンは VERSION から自動で付く）
export const FOOTER_NOTE = '';

// ===== 拡張パック（v1.1.0で導入） =====
// パックは site/packs/<id>/ に置く。有効化はここの ENABLED_PACKS だけが決める。
// build-site.mjs は、有効なパックのタブだけをタブバーに足し、
// providesNewTab なパックがあるときだけ「＋ 新規タブ」ボタンと
// パックの CSS/JS を各ページに配る。無効なパックのものは HTML に一切出ない。
export const ENABLED_PACKS = ['terminal'];

export const PACK_PAGES = [
  { pack: 'terminal', file: 'packs/terminal/terminal.html', label: 'ターミナル', title: 'ターミナル - きなこのサイト', desc: 'きなこのサイトの拡張パック「ターミナル」。サイト内をコマンドで操作できる。', providesNewTab: true },
];
