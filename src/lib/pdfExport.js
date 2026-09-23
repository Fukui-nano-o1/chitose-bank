// 画面の要素をそのままPDFにして保存する（2026-08-19たきと報告「PDF保存ができない」）。
//
// 【なぜ印刷ダイアログに頼らないか】iPhone Safari は window.print() で印刷シートは出るものの、
// そこからPDFにするには「プレビューをピンチで開く→共有→"ファイル"に保存」という隠れた操作が要る。
// このサービスの利用者に強いる操作ではないので、ボタン一発でPDFファイルが保存される形にした。
//
// 【作り】通知書だけを別documentへ写す → html2canvasでA4 1枚ずつ画像化 → 自前でPDFに包む。
// ・日本語フォントは端末内のものを使う＝PDFのためにWebフォントを読み直さない。
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

// 待機時間はimportから保存準備までの全体で制限する。html2canvasのimageTimeoutは
// フォント・WebKitのimagesReady・iframeのロード待ちには効かない（1.4.1の実装）。
export const PDF_TIMEOUT_MS = 20000;
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';

// 文字の行・写真の途中では改ページしない。1ページより高い要素だけ分割する。
export function pdfPageSlices(height, limit, lines = []) {
  if (!(height > 0 && limit >= 1) || !Number.isFinite(height + limit)) throw new Error("PDF_EMPTY_DOCUMENT");
  const slices = [];
  for (let top = 0; top < height;) {
    let bottom = Math.min(height, top + limit);
    while (bottom < height) {
      const crossing = lines.filter(line => line.top < bottom && line.bottom > bottom);
      if (!crossing.length) break;
      const before = Math.floor(Math.min(...crossing.map(line => line.top)));
      if (before <= top) break;
      bottom = before;
    }
    slices.push({ top, height: bottom - top });
    top = bottom;
  }
  return slices;
}

function lineBounds(element) {
  const doc = element.ownerDocument;
  const origin = element.getBoundingClientRect().top;
  const out = [];
  const range = doc.createRange();
  if (typeof range.getClientRects !== "function") return out;
  const walker = doc.createTreeWalker(element, doc.defaultView.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) out.push({ top: rect.top - origin, bottom: rect.bottom - origin });
    }
  }
  for (const img of element.querySelectorAll("img")) {
    const rect = img.getBoundingClientRect();
    if (rect.height > 0) out.push({ top: rect.top - origin, bottom: rect.bottom - origin });
  }
  return out;
}

// 通知書だけを別のdocumentへ写す。アプリ全体の画像・地図・Webフォントを複製しない。
// 見た目は元の計算済みスタイルを持ち込み、フォントだけ端末内のものに固定する。
function copyForPdf(source, targetDocument) {
  if (source.nodeType === 3) return targetDocument.createTextNode(source.textContent);
  if (source.nodeType !== 1 || source.classList.contains("no-print") ||
      ["SCRIPT", "STYLE", "LINK", "IFRAME"].includes(source.tagName)) return null;
  const clone = targetDocument.importNode(source.cloneNode(false), false);
  const style = source.ownerDocument.defaultView.getComputedStyle(source);
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    clone.style.setProperty(name, style.getPropertyValue(name));
  }
  clone.style.fontFamily = SYSTEM_FONT;
  clone.style.animation = "none";
  clone.style.transition = "none";
  // 文字幅が変わっても段落が伸びるようにする。画像の表示寸法は維持。
  if (source.tagName !== "IMG") {
    clone.style.removeProperty("width");
    clone.style.removeProperty("height");
  } else {
    clone.loading = "eager";
    clone.src = source.currentSrc || source.src;
  }
  for (const child of source.childNodes) {
    const copy = copyForPdf(child, targetDocument);
    if (copy) clone.appendChild(copy);
  }
  return clone;
}

// filename は拡張子なし。全処理が終わるまでダウンロードを始めない。
export async function saveElementAsPdf(el, filename) {
  if (!el?.isConnected) throw new Error("PDF_SOURCE_MISSING");
  const owner = el.ownerDocument;
  const view = owner.defaultView;
  const deadline = Date.now() + PDF_TIMEOUT_MS;
  let frame;
  let timer;
  let expired = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error("PDF_TIMEOUT")); }, PDF_TIMEOUT_MS);
  });
  // 期限を過ぎた作業を再開して保存しない。遅れて返るimport/画像化は結果を捨てる。
  const wait = promise => Promise.race([promise, timeout]);
  try {
    const { default: html2canvas } = await wait(import("html2canvas"));
    if (!el.isConnected) throw new Error("PDF_SOURCE_MISSING");
    const width = Math.ceil(el.getBoundingClientRect().width || el.scrollWidth);
    if (!Number.isFinite(width) || width < 1) throw new Error("PDF_EMPTY_DOCUMENT");
    frame = owner.createElement("iframe");
    frame.title = "PDF作成用";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:1000px;border:0;pointer-events:none;`;
    owner.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) throw new Error("PDF_DOCUMENT_UNAVAILABLE");
    doc.open();
    doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    doc.body.style.cssText = "margin:0;background:#fff;";
    const copy = copyForPdf(el, doc);
    copy.style.cssText += `;position:static;transform:none;overflow:visible;width:${width}px;max-width:none;height:auto;max-height:none;margin:0;box-sizing:border-box;`;
    doc.body.appendChild(copy);
    const height = Math.ceil(copy.scrollHeight || copy.getBoundingClientRect().height);
    if (!Number.isFinite(height) || height < 1) throw new Error("PDF_EMPTY_DOCUMENT");

    // 長い通知書を巨大なcanvasにしない。A4 1ページずつ描いて、直後にメモリを解放する。
    // 幅1200pxまで＝1枚あたり約212万画素。端末の倍率や書面の長さに左右されない。
    const scale = Math.min(2, Math.max(1, view.devicePixelRatio || 1), 1200 / width);
    const sliceH = Math.max(1, Math.floor(width * (A4_H - MARGIN * 2) / (A4_W - MARGIN * 2)));
    const pages = [];
    for (const slice of pdfPageSlices(height, sliceH, lineBounds(copy))) {
      if (expired || Date.now() >= deadline) throw new Error("PDF_TIMEOUT");
      const canvas = await wait(html2canvas(copy, {
        backgroundColor: "#ffffff", scale, useCORS: true, logging: false,
        width, height: slice.height, y: slice.top,
        windowWidth: width, windowHeight: sliceH, scrollX: 0, scrollY: 0,
        imageTimeout: 5000,
        ignoreElements: n => !!n?.classList?.contains("no-print"),
      }));
      try {
        if (!canvas.width || !canvas.height) throw new Error("PDF_EMPTY_CANVAS");
        const data = canvas.toDataURL("image/jpeg", 0.92);
        if (!data.startsWith("data:image/jpeg;base64,")) throw new Error("PDF_INVALID_IMAGE");
        pages.push({ w: canvas.width, h: canvas.height, jpeg: jpegBytes(data) });
      } finally {
        canvas.width = 0; canvas.height = 0;
      }
    }
    if (expired || Date.now() >= deadline) throw new Error("PDF_TIMEOUT");
    const blob = new Blob([buildPdf(pages)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = owner.createElement("a");
    a.href = url;
    a.download = (filename || "document") + ".pdf";
    a.rel = "noopener";
    try { owner.body.appendChild(a); a.click(); }
    finally {
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return pages.length;
  } finally {
    clearTimeout(timer);
    // タイムアウトしたhtml2canvas自身のiframeも、このdocumentと一緒に破棄する。
    frame?.remove();
  }
}
