// 求人の共有カード（2026-08-25たきと指示「該当する求人カードを表示させたい」）。
//
// 【なぜサーバー側が要るか】このアプリはハッシュルーティング（#/work/job/1268）で、#より後ろは
// サーバーに届かない。LINE・X等のクローラーはJSを実行しないため、共有すると常にサイト既定の
// カード（緑のロゴ＋chitose-bank）しか出せなかった。
// 【対処】#を含まない実URL /j/{番号} をここで受け、その求人のOGタグを付けたHTMLを返す。
//   ・クローラー＝JSを実行しないので、このHTMLのOGタグ（写真・作物×作業・地域・報酬）を読む
//   ・人＝JSで #/work/job/{番号} へ即座に飛ぶ（見た目は一瞬のつなぎ画面）
// 【★取得は必ず anon キー】＝訪問者と同じ見え方になる（jobs_public の anon マスクthatそのまま効く）。
//   service role を使うと町域・番地・募集主のマスクthat外れる＝共有カードに載ってしまう。使わないこと。
// 【載せる情報】訪問者に既に見えているものだけ：作物・作業・都道府県市区町村（町域は載せない）・
//   日程・報酬・写真。番地／募集主の氏名・住所・連絡先は載せない。
// 【関連】共有ボタン＝src/components/JobSearchMapView.jsx の shareJob（この /j/{番号} を渡す）。
//   経路の書き換え＝vercel.json の rewrites（/j/:num → /api/j/:num）。

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 利用者の自由入力（作物名・作業名等）をそのままHTMLに置かない
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 報酬の一言（数字以外that入っている行は金額を出さない＝嘘を書かない）
function payLine(job) {
  const n = (v) => {
    const s = String(v == null ? "" : v).trim();
    return /^[0-9]+$/.test(s) ? Number(s).toLocaleString("ja-JP") : null;
  };
  if (job.pay_type === "時給") { const v = n(job.hourly_wage); return v ? `時給 ${v}円` : ""; }
  const v = n(job.daily_wage);
  return v ? `日給 ${v}円` : "";
}

function firstPhoto(job) {
  const list = Array.isArray(job.photos) ? job.photos : [];
  for (const p of list) {
    const url = typeof p === "string" ? p : (p && p.url);
    if (typeof url === "string" && url.startsWith("https://")) return url;
  }
  return null;
}

export default async function handler(req, res) {
  const raw = req.query && req.query.num;
  const num = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  const host = req.headers["x-forwarded-host"] || req.headers.host || "chitose-bank.com";
  const origin = `https://${host}`;
  const appUrl = Number.isFinite(num) ? `${origin}/#/work/job/${num}` : `${origin}/#/search`;

  let job = null;
  if (Number.isFinite(num) && SUPABASE_URL && ANON_KEY) {
    try {
      const q = new URL(`${SUPABASE_URL}/rest/v1/jobs_public`);
      q.searchParams.set("job_number", `eq.${num}`);
      // 載せる列だけを取る（町域・番地・募集主は取りに行かない＝そもそも手元に置かない）
      q.searchParams.set("select", "job_number,crop,task,prefecture,city,date_label,pay_type,daily_wage,hourly_wage,photos,status");
      q.searchParams.set("limit", "1");
      const opt = { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } };
      try { if (AbortSignal.timeout) opt.signal = AbortSignal.timeout(4000); } catch { /* 未対応環境はそのまま */ }
      const r = await fetch(q, opt);
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) job = rows[0];
      }
    } catch { /* 取れなければ既定のカードに落ちる（リンク自体は開ける） */ }
  }

  // 求人that見つからない（下書き・一時非公開・番号違い）時はサイト既定のカード＝リンクは開ける
  const region = job ? `${job.prefecture || ""}${job.city || ""}` : "";
  const title = job
    ? `${[job.crop, job.task].filter(Boolean).join(" ")}${region ? `｜${region}` : ""}`.trim() || `求人 #${num}`
    : "chitose-bank";
  const descParts = job
    ? [payLine(job), job.date_label, region, job.status === "open" ? "" : "募集は終了しました"].filter(Boolean)
    : ["徳島県吉野川市の農家と働き手をつなぐ、農作業のマッチングサービス"];
  const description = descParts.join("／");
  const image = (job && firstPhoto(job)) || `${origin}/pwa-512.png`;
  const pageUrl = Number.isFinite(num) ? `${origin}/j/${num}` : origin;

  // 診断の目印（値は入れない）：ページのソースを見れば
  //   job=求人を引けた／not-found=番号は有効thatが見つからない／no-env=接続情報が無い
  // の区別thatつく。共有カードthatサイト既定のままの時の切り分けに使う
  const srcTag = job ? "job" : (SUPABASE_URL && ANON_KEY ? "not-found" : "no-env");

  const html = `<!doctype html>
<html lang="ja">
<head>
<!-- src:${srcTag} -->
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} | chitose-bank</title>
<link rel="canonical" href="${esc(appUrl)}" />
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="chitose-bank" />
<meta property="og:url" content="${esc(pageUrl)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;background:#fff;color:#222}
  .wrap{max-width:420px;margin:0 auto;padding:24px 16px;text-align:center}
  .ph{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:16px;background:#F2F2F2}
  h1{font-size:18px;margin:16px 0 6px}
  p{font-size:13px;color:#717171;margin:0 0 20px}
  a{display:inline-block;background:#00A86B;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:14px}
</style>
</head>
<body>
  <div class="wrap">
    <img class="ph" src="${esc(image)}" alt="" />
    <h1>${esc(title)}</h1>
    <p>${esc(description)}</p>
    <a href="${esc(appUrl)}">求人を見る</a>
  </div>
  <script>location.replace(${JSON.stringify(appUrl)});</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // クローラーの再取得と連続タップthat速い程度に短く持つ（求人の変更that何時間も残らない長さ）
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=86400");
  return res.status(200).send(html);
}
