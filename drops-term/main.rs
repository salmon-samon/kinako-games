// きなこのしずくあつめ（ターミナル版）
// ガラスのきなこを左右に動かして、水のしずくを15滴集めるゲーム。
// 墨汁（x）を取ったり、水を逃したりすると ❤ が減って、3回でゲームオーバー。
// 操作: a / d か ← / → で移動、他のキーは1ターン待ち、q で終了。
// 依存なし（stdのみ）。rustc main.rs でビルドできる。

use std::io::{self, IsTerminal, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

const W: i32 = 28;
const H: i32 = 14;
const GOAL: i32 = 15;

struct Drop {
    x: i32,
    y: i32,
    bad: bool,
}

// 雑な乱数（LCG）。stdだけで済ませるため。
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn main() {
    let stdin = io::stdin();
    let is_tty = stdin.is_terminal();
    if is_tty {
        // 端末をrawモードにして1キーずつ読めるようにする
        let _ = std::process::Command::new("stty").args(["raw", "-echo"]).status();
    }

    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(42);
    let mut rng = Rng(seed ^ 0x9e3779b97f4a7c15);

    let mut player_x: i32 = W / 2;
    let mut drops: Vec<Drop> = Vec::new();
    let mut score: i32 = 0;
    let mut life: i32 = 3;
    let mut turn: u64 = 0;
    let mut message = String::from("a/d か ←→ で動いて、水のしずく（o）を集めよう。墨汁（x）は避けてね。");

    let mut input = stdin.lock().bytes();
    let mut stdout = io::stdout();

    let result: &str = loop {
        // ---- 描画 ----
        let mut s = String::new();
        s.push_str("\x1b[2J\x1b[H");
        s.push_str("=== きなこのしずくあつめ ===\r\n");
        s.push_str(&format!("みず: {}/{}  ❤: {}  ターン: {}\r\n", score, GOAL, life, turn));
        s.push_str(&format!("{}\r\n", "-".repeat(W as usize + 2)));
        for y in 0..H {
            let mut row = String::from("|");
            for x in 0..W {
                if y == H - 1 && (x - player_x).abs() <= 1 {
                    // ガラスの体（真ん中は集めた水）
                    row.push(if x == player_x { '~' } else if x < player_x { '[' } else { ']' });
                } else if let Some(d) = drops.iter().find(|d| d.x == x && d.y == y) {
                    if d.bad {
                        row.push_str("\x1b[31mx\x1b[0m");
                    } else {
                        row.push_str("\x1b[36mo\x1b[0m");
                    }
                } else {
                    row.push(' ');
                }
            }
            row.push_str("|\r\n");
            s.push_str(&row);
        }
        s.push_str(&format!("{}\r\n", "-".repeat(W as usize + 2)));
        s.push_str(&format!("{}\r\n", message));
        let _ = stdout.write_all(s.as_bytes());
        let _ = stdout.flush();

        if score >= GOAL {
            break "クリア！ ガラスいっぱいに水が集まった。";
        }
        if life <= 0 {
            break "ゲームオーバー… ガラスが墨で真っ黒になっちゃった。";
        }

        // ---- 入力（1キー = 1ターン） ----
        let b = match input.next() {
            Some(Ok(v)) => v,
            _ => break "入力が終わったので終了。",
        };
        if b == b'q' {
            break "またね。";
        }
        if b == 0x1b {
            // 矢印キー: ESC [ C / D
            let b2 = input.next().and_then(|r| r.ok());
            let b3 = input.next().and_then(|r| r.ok());
            if b2 == Some(b'[') {
                match b3 {
                    Some(b'C') => player_x = (player_x + 1).min(W - 2),
                    Some(b'D') => player_x = (player_x - 1).max(1),
                    _ => {}
                }
            }
        } else if b == b'a' {
            player_x = (player_x - 1).max(1);
        } else if b == b'd' {
            player_x = (player_x + 1).min(W - 2);
        }
        turn += 1;

        // ---- しずくの落下と判定 ----
        for d in drops.iter_mut() {
            d.y += 1;
        }
        let mut new_message = String::new();
        drops.retain(|d| {
            if d.y >= H - 1 {
                if (d.x - player_x).abs() <= 1 {
                    if d.bad {
                        life -= 1;
                        new_message = format!("墨汁をかぶった… ❤ {}", life);
                    } else {
                        score += 1;
                        new_message = format!("しずくゲット！ {}/{}", score, GOAL);
                    }
                } else if !d.bad {
                    life -= 1;
                    new_message = format!("水を逃した… ❤ {}", life);
                }
                false
            } else {
                true
            }
        });
        if !new_message.is_empty() {
            message = new_message;
        }

        // ---- 新しいしずく ----
        if rng.below(100) < 38 {
            let bad = rng.below(100) < 25;
            let x = rng.below(W as u64) as i32;
            drops.push(Drop { x, y: 0, bad });
        }
    };

    let _ = writeln!(stdout, "{}", result);
    let _ = writeln!(stdout, "最終スコア: みず {}/{}  ❤ {}", score, GOAL, life);
    let _ = stdout.flush();
    if is_tty {
        let _ = std::process::Command::new("stty").arg("sane").status();
    }
}
