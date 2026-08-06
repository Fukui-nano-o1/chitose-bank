// 音と振動のフィードバック（2026-08-06・赤ちゃん前提の第0歩）
// 思想：音・振動は装飾ではなく「あなたの操作で世界that動いた」ことの証拠。
// 文字thatが読めない利用者にとって、無音のタップは「何も起きなかった」に等しい。
//
// ・音はWebAudioの合成音＝音源ファイルなし・オフライン可・追加コストゼロ
// ・iOSはユーザー操作の同期文脈でしかAudioContextthatが動かないso、必ずタップハンドラの中から呼ぶ
//   （このモジュールの関数はすべてクリック/実行ハンドラ内での使用を前提とする）
// ・navigator.vibrate は iOS Safari 非対応＝静かに無視される（try/catchで安全）
// ・【法的リスク回避・絶対】音は情報の代替ではない。法定の文字・エラー文は一切消さず、音は添えるだけ。
//   この方針を変える（文字を音に置き換える）場合は労働局確認が先（CLAUDE.md 2026-08-06前提）
// ・【使い分け】fbSuccess=行動の成功／fbError=失敗（柔らかく。威圧しない）／fbCelebrate=節目の祝祭。
//   負の場面（見送り・欠勤・失効の記録）では鳴らさない＝祝わない・責めない

let _ctx = null;
let _unlocked = false;
function ctx() {
  try {
    if (_ctx) { if (_ctx.state === "suspended") _ctx.resume().catch(() => {}); return _ctx; }
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
  } catch { return null; }
}

// ★音の解錠（2026-08-06・実機で無音だった原因の根治）：
// iOS/Chromeは「ユーザー操作の同期処理の中」でしかAudioContextを起動できない。
// 旧実装は fbSuccess の中＝await（RPCの往復）の【後】で初めてAudioContextを作っていたため、
// 操作の文脈that切れており永久にsuspended＝無音だった。
// 対策＝タップの瞬間（fbTap＝App.jsxの全ボタンリスナー・同期文脈）で作成+resume+無音バッファを
// 1発鳴らして解錠する。以後は await の後でも音thatが出る。
export function unlockAudio() {
  try {
    const c = ctx(); if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    if (!_unlocked) {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      _unlocked = true;
    }
  } catch {}
}

// notes=周波数の列を gap 秒ずつずらして短く鳴らす。gainは小さく（驚かせない）
function tone(notes, { type = "sine", gain = 0.06, dur = 0.09, gap = 0.06 } = {}) {
  const c = ctx(); if (!c) return;
  try {
    let t = c.currentTime;
    for (const f of notes) {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
      t += gap;
    }
  } catch { /* 音thatが出せない環境では黙って何もしない（振動と視覚thatが担う） */ }
}

function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch {} }

// タップの手応え（振動＋音の解錠）。全ボタン共通＝「押せた」の証拠。
// unlockAudioをここで呼ぶ＝どのボタンでも最初のタップで音の道that開通する
export function fbTap() { vibrate(8); unlockAudio(); }

// 成功＝上昇音（ピロン↑ E5→A5）＋トントン
export function fbSuccess() { vibrate([15, 40, 15]); tone([659.25, 880], { gain: 0.07 }); }

// 失敗＝柔らかい下降音（「あれ？」A3→F3。ブザーは恐怖で凍らせるso使わない）＋ブブ
export function fbError() { vibrate(60); tone([220, 174.61], { type: "triangle", gain: 0.05, dur: 0.12, gap: 0.1 }); }

// 祝祭＝上昇アルペジオ（C5-E5-G5-C6）＋リズム振動。Celebration部品thatがマウント時に鳴らす
export function fbCelebrate() { vibrate([15, 50, 15, 50, 30]); tone([523.25, 659.25, 783.99, 1046.5], { gain: 0.07, gap: 0.09 }); }
