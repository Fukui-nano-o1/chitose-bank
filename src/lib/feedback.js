// 音と振動のフィードバック（2026-08-06・赤ちゃん前提の第0歩）
// 思想：音・振動は装飾ではなく「あなたの操作で世界が動いた」ことの証拠。
// 文字が読めない利用者にとって、無音のタップは「何も起きなかった」に等しい。
//
// ・音はWebAudioの合成音＝音源ファイルなし・オフライン可・追加コストゼロ
// ・【解錠】iOS/Chromeはユーザー操作の同期文脈でしかAudioContextを起動できない。
//   App.jsxの全域リスナー（pointerdown＋click）が毎タップ unlockAudio() を呼ぶ＝
//   最初のタップで音の道が開通し、以後は await（RPC往復）の後でも音が出る。
//   ※旧実装はawaitの後に初めてAudioContextを作っていた＝永久suspended＝無音（2026-08-06根治）
// ・【消音スイッチ】iPhoneのマナーモード中、WebAudioは既定で完全ミュート。
//   iOS 17+ の Audio Session API（navigator.audioSession.type='transient'）で
//   「通知のような短いUI音」として消音中でも鳴らす（他アプリの音楽は止めない）。
//   iOS 16以前は消音スイッチがON だと鳴らない（打つ手なし＝仕様。振動と視覚が担う）
// ・【音量】UI音はスマホのスピーカーでは想像よりずっと小さく出る。sine波90ms/gain0.07は
//   実機でほぼ聞こえなかった（2026-08-06実機報告）→ VOL=0.3・0.15〜0.2s・倍音のある波形に増強。
//   うるさければ VOL の1箇所だけ下げる
// ・navigator.vibrate は iOS Safari 非対応＝静かに無視される（try/catchで安全）
// ・【法的リスク回避・絶対】音は情報の代替ではない。法定の文字・エラー文は一切消さず、音は添えるだけ。
//   この方針を変える（文字を音に置き換える）場合は労働局確認が先（CLAUDE.md 2026-08-06前提）
// ・【使い分け】fbSuccess=行動の成功／fbError=失敗（柔らかく。威圧しない）／fbCelebrate=節目の祝祭。
//   負の場面（見送り・欠勤・失効の記録）では鳴らさない＝祝わない・責めない

const VOL = 0.3; // 全体音量（0〜1）。調整はここ1箇所

let _ctx = null;
let _unlocked = false;
function ctx() {
  try {
    if (_ctx) { if (_ctx.state !== "running") _ctx.resume().catch(() => {}); return _ctx; }
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 消音スイッチ対策（iOS 17+）：短いUI音として登録＝マナーモード中でも鳴る・音楽と混ざる
    try { if (navigator.audioSession) navigator.audioSession.type = "transient"; } catch {}
    return _ctx;
  } catch { return null; }
}

// ★音の解錠：タップの同期文脈の中で 作成+resume+無音バッファ1発。App.jsxがが毎タップ呼ぶ
export function unlockAudio() {
  try {
    const c = ctx(); if (!c) return;
    if (c.state !== "running") c.resume().catch(() => {});
    if (!_unlocked) {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      _unlocked = true;
    }
  } catch {}
}

// notes=周波数の列を gap 秒ずつずらして鳴らす。三角波＝倍音がありスマホのスピーカーでも通る
function tone(notes, { type = "triangle", gain = VOL, dur = 0.18, gap = 0.09 } = {}) {
  const c = ctx(); if (!c) return;
  try {
    let t = c.currentTime;
    for (const f of notes) {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
      t += gap;
    }
  } catch { /* 音が出せない環境では黙って何もしない（振動と視覚が担う） */ }
}

// タップの手応え（振動＋音の解錠）。全ボタン共通＝「押せた」の証拠。
// unlockAudioをここでも呼ぶ＝どのボタンでも最初のタップで音の道が開通する
export function fbTap() { vibrate(8); unlockAudio(); }

function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch {} }

// 成功＝上昇音（ピロン↑ E5→A5）＋トントン
export function fbSuccess() { vibrate([15, 40, 15]); tone([659.25, 880]); }

// 失敗＝柔らかい下降音（「あれ？」A3→F3。ブザーは恐怖で凍らせるので使わない）＋ブブ
export function fbError() { vibrate(60); tone([220, 174.61], { type: "sine", gain: VOL * 0.7, dur: 0.2, gap: 0.13 }); }

// 祝祭＝花火のファンファーレ（上昇アルペジオC5-E5-G5-C6＋てっぺんで和音）＋リズム振動。
// Celebration部品（暗幕→打ち上げ→炸裂）がマウント時に鳴らす
export function fbCelebrate() {
  vibrate([15, 50, 15, 50, 30]);
  tone([523.25, 659.25, 783.99, 1046.5], { dur: 0.16, gap: 0.11 });
  // 炸裂の和音（打ち上げの後・0.45s＝Celebrationの炸裂タイミングに合わせる）
  try {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + 0.45;
    for (const f of [783.99, 1046.5, 1318.5]) {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(VOL * 0.8, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + 0.6);
    }
  } catch {}
}
