// 画面の要素をそのままPDFにして保存する（2026-08-19たきと報告「PDF保存ができない」）。
//
// 【なぜ印刷ダイアログに頼らないか】iPhone Safari は window.print() で印刷シートは出るものの、
// そこからPDFにするには「プレビューをピンチで開く→共有→"ファイル"に保存」という隠れた操作が要る。
// このサービスの利用者に強いる操作ではないので、ボタン一発でPDFファイルが保存される形にした。
//
// 【作り】ブラウザが描いた見た目をそのまま写す（html2canvas）→ JPEG → 自前でPDFに包む。
// ・日本語フォントの同梱（数MB）が要らない＝文字はブラウザのフォントで描かれたものを写すだけ。
// ・代わりに文字は画像になる（PDF内での選択・検索はできない）。紙に出した書面と同じ扱いと考えて割り切った。
// ・PDFの組み立ては自前（jsPDF等は入れない）。JPEG1枚＝1ページの最小構成なので短い。
// ・html2canvas は動的import＝この機能を使うまで読み込まない（起動の重さを増やさない）。
//
// ★A4縦・余白36pt（約12.7mm）固定。長い書面は同じ幅のまま縦に切ってページを足す。

const A4_W = 595.28, A4_H = 841.89, MARGIN = 36;

// latin1の文字列 → バイト列（PDFはヘッダも中身も1文字1バイトで書く）
const bytes = (s) => {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
};

// dataURL（image/jpeg）→ バイト列
const jpegBytes = (dataUrl) => bytes(atob(dataUrl.split(",")[1]));

// ページ（JPEG）の配列からPDFのバイト列を作る
export function buildPdf(pages) { // exportは検証用（本番の呼び出しは saveElementAsPdf のみ）
  const chunks = [];
  let len = 0;
  const put = (u8) => { chunks.push(u8); len += u8.length; };
  const putStr = (s) => put(bytes(s));

  const n = pages.length;
  const pageIds = [];
  for (let i = 0; i < n; i++) pageIds.push(3 + i * 3);
  const offsets = {};

  putStr("%PDF-1.4\n");
  offsets[1] = len;
  putStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = len;
  putStr(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map(id => id + " 0 R").join(" ")}] /Count ${n} >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pid = 3 + i * 3, iid = pid + 1, cid = pid + 2;
    // 幅を余白いっぱいに合わせ、高さは元の比率のまま（はみ出す時はページの高さに合わせる）
    let drawW = A4_W - MARGIN * 2;
    let drawH = drawW * (p.h / p.w);
    const maxH = A4_H - MARGIN * 2;
    if (drawH > maxH) { drawH = maxH; drawW = drawH * (p.w / p.h); }
    const x = (A4_W - drawW) / 2;
    const y = A4_H - MARGIN - drawH; // 上端から置く（下に余りが出る＝最後のページ）

    offsets[pid] = len;
    putStr(`${pid} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>\nendobj\n`);

    offsets[iid] = len;
    putStr(`${iid} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    put(p.jpeg);
    putStr("\nendstream\nendobj\n");

    const content = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q\n`;
    offsets[cid] = len;
    putStr(`${cid} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const total = 2 + n * 3;
  const xrefAt = len;
  putStr(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) {
    putStr(String(offsets[id]).padStart(10, "0") + " 00000 n \n");
  }
  putStr(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// 画面の要素をPDFにして保存する。filename は拡張子なしで渡す
export async function saveElementAsPdf(el, filename) {
  if (!el) throw new Error("no element");
  const { default: html2canvas } = await import("html2canvas");
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1)); // 2倍まで＝読める大きさとファイルの重さの折り合い
  const canvas = await html2canvas(el, {
    backgroundColor: "#ffffff",
    scale,
    useCORS: true,
    logging: false,
    windowWidth: el.scrollWidth,
    // ★.no-print（印刷する／PDFで保存／とじる）はPDFにも写さない。
    //   @media print は画像化には効かないので、ここで明示的に外す
    ignoreElements: (n) => !!(n && n.classList && n.classList.contains("no-print")),
  });

  // A4の紙に収まる高さで縦に切る（1枚に入るなら1ページ）
  const pageRatio = (A4_H - MARGIN * 2) / (A4_W - MARGIN * 2);
  const sliceH = Math.floor(canvas.width * pageRatio);
  const pages = [];
  for (let top = 0; top < canvas.height; top += sliceH) {
    const h = Math.min(sliceH, canvas.height - top);
    const c = document.createElement("canvas");
    c.width = canvas.width; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
    pages.push({ w: c.width, h, jpeg: jpegBytes(c.toDataURL("image/jpeg", 0.92)) });
  }

  const pdf = buildPdf(pages);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (filename || "document") + ".pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000); // iOSは開き終わるまで残す
  return pages.length;
}
