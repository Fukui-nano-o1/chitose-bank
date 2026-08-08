// iOS PWAの起動画像（apple-touch-startup-image）を生成する（2026-08-08たきと報告
// 「リロードやサイトに入った時、画面が真っ黒」の根治・PWA側）。
//
// なぜ要るか：index.html に apple-mobile-web-app-status-bar-style="black-translucent" を
// 指定していると、iOSはホーム画面から起動した瞬間の画面（launch screen）を【黒】で描く。
// これはWebページが1行も動く前の話so、CSSでもJSでも直せない。唯一の手段が、端末サイズごとの
// 起動画像を <link rel="apple-touch-startup-image"> で与えること（Androidはmanifestの
// background_color=#FFFFFFを使うため元から白＝この問題はiOSだけ）。
//
// 何を描くか：index.html の #cb-boot（起動スケルトン）と【同じ形】の骨を白地に描く。
// これで「iOSの起動画面 → HTMLの骨 → Reactの骨 → 本体」が同じ絵で繋がり、黒も白飛びも起きない。
//
// 実行： node scripts/gen-splash.mjs   （public/splash/*.png を作り直す。依存パッケージ無し）
// 画像は白と灰だけsoグレースケールPNG（1画素1バイト）＋平坦な行sozlibで数KBに収まる。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── 最小PNG書き出し（グレースケール8bit・フィルタ0）────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodeGrayPng(w, h, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // color type 0 = grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate / adaptive filter / no interlace
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // フィルタ種別 0（なし）
    pixels.copy(raw, y * (w + 1) + 1, y * w, y * w + w);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 骨の描画（#cb-boot と同じ色・同じ寸法）──────────────────────────────
const BG = 255;      // 白
const BORDER = 240;  // #F0F0F0
const BAR = 237;     // シマーの中間色（静止画なので単色）

const makeCanvas = (w, h) => { const p = Buffer.alloc(w * h, BG); return p; };
const fillRect = (p, W, H, x, y, w, h, v) => {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) p.fill(v, yy * W + x0, yy * W + x1);
};
// 角丸矩形：角だけ円の内側判定で落とす（骨なので中身は単色）
const roundRect = (p, W, H, x, y, w, h, r, v) => {
  const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + w), y1 = Math.round(y + h);
  const rr = Math.min(Math.round(r), Math.floor((x1 - x0) / 2), Math.floor((y1 - y0) / 2));
  for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) {
    for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
      const dx = xx < x0 + rr ? x0 + rr - xx : xx >= x1 - rr ? xx - (x1 - rr - 1) : 0;
      const dy = yy < y0 + rr ? y0 + rr - yy : yy >= y1 - rr ? yy - (y1 - rr - 1) : 0;
      if (dx && dy && dx * dx + dy * dy > rr * rr) continue;
      p[yy * W + xx] = v;
    }
  }
};

// 論理サイズ(CSS px)で #cb-boot と同じ配置を描く。s=デバイスピクセル比
function drawBoot(dw, dh, s, notched) {
  const W = Math.round(dw * s), H = Math.round(dh * s);
  const p = makeCanvas(W, H);
  const P = (v) => v * s; // CSS px → デバイス px
  // ヘッダー（高さ64・下境界1px）
  fillRect(p, W, H, 0, P(63), W, P(1), BORDER);
  roundRect(p, W, H, P(16), P(21), P(120), P(22), P(6), BAR);
  // 本文（padding16・gap10）：検索ピル44 → カード190×3
  let y = 64 + 16;
  roundRect(p, W, H, P(16), P(y), P(dw - 32), P(44), P(22), BAR);
  y += 44 + 10;
  // 下部バーの帯（64＋ホームインジケータ34）にかからない範囲までカードを積む
  const footH = 64 + (notched ? 34 : 0);
  while (y + 60 < dh - footH) {
    const cardH = Math.min(190, dh - footH - y - 10);
    roundRect(p, W, H, P(16), P(y), P(dw - 32), P(cardH), P(14), BAR);
    y += cardH + 10;
  }
  // 下部バー（上境界＋アイコン3つ・64pxの帯の中で縦中央）
  const footTop = dh - footH;
  fillRect(p, W, H, 0, P(footTop), W, P(1), BORDER);
  const iy = footTop + (64 - 34) / 2;
  for (let i = 0; i < 3; i++) {
    const cx = (dw / 3) * (i + 0.5);
    roundRect(p, W, H, P(cx - 17), P(iy), P(34), P(34), P(10), BAR);
  }
  return { W, H, p };
}

// ── 対象端末（iPhone・縦横の両方。合致するものが無いとiOSは黒に戻るので広めに用意）──
// device-width / device-height はCSS px、s は -webkit-device-pixel-ratio
const DEVICES = [
  { dw: 320, dh: 568, s: 2, notched: false }, // SE(1st)
  { dw: 320, dh: 480, s: 2, notched: false }, // 4s以前
  { dw: 375, dh: 667, s: 2, notched: false }, // SE(2/3), 8
  { dw: 414, dh: 736, s: 3, notched: false }, // 8 Plus
  { dw: 375, dh: 812, s: 3, notched: true },  // X, XS, 11 Pro, 12/13 mini
  { dw: 414, dh: 896, s: 2, notched: true },  // XR, 11
  { dw: 414, dh: 896, s: 3, notched: true },  // XS Max, 11 Pro Max
  { dw: 390, dh: 844, s: 3, notched: true },  // 12, 13, 14
  { dw: 428, dh: 926, s: 3, notched: true },  // 12/13 Pro Max, 14 Plus
  { dw: 393, dh: 852, s: 3, notched: true },  // 14 Pro, 15, 15 Pro, 16
  { dw: 430, dh: 932, s: 3, notched: true },  // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { dw: 402, dh: 874, s: 3, notched: true },  // 16 Pro
  { dw: 440, dh: 956, s: 3, notched: true },  // 16 Pro Max
];

const outDir = join(process.cwd(), "public", "splash");
mkdirSync(outDir, { recursive: true });
if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.endsWith(".png")) unlinkSync(join(outDir, f));

const links = [];
let total = 0;
for (const d of DEVICES) {
  for (const orient of ["portrait", "landscape"]) {
    // 横向きは幅と高さを入れ替えて同じ骨を描く（合致画像が無いと黒に戻るため横も用意する）
    const dw = orient === "portrait" ? d.dw : d.dh;
    const dh = orient === "portrait" ? d.dh : d.dw;
    const { W, H, p } = drawBoot(dw, dh, d.s, d.notched);
    const name = `${d.dw}x${d.dh}@${d.s}-${orient}.png`;
    const png = encodeGrayPng(W, H, p);
    writeFileSync(join(outDir, name), png);
    total += png.length;
    links.push(
      `    <link rel="apple-touch-startup-image" href="/splash/${name}" ` +
      `media="(device-width: ${d.dw}px) and (device-height: ${d.dh}px) and (-webkit-device-pixel-ratio: ${d.s}) and (orientation: ${orient})" />`
    );
  }
}
console.log(links.join("\n"));
console.error(`\n${links.length} images, ${(total / 1024).toFixed(1)} KB total -> public/splash/`);
