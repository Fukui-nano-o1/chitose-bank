import React from "react";

// 下部ナビのアウトラインアイコン（2026-08-22たきと指示「Airbnbのアイコン風に差し替え」）。
// Airbnbの実アセットは流用できない（プロプライエタリ）ため、同じ視覚言語＝細いストロークの
// アウトラインSVGを自前で描いた。stroke="currentColor" なので、.app-header-mobile-tab の
// color（非アクティブ#717171／アクティブ=役割色 --role-accent）にそのまま染まる
// ＝絵文字時代には無かった「アクティブで色が変わる」挙動が付いてくる（Airbnbと同じ）。
// ★「カレンダー」タブ=カレンダー枠／「今日」タブ=時計 で描き分け＝📅📆の取り違え問題（旧コメント）はここで解消。
// アイコンを足す時は NAV_ICON_PATHS に1エントリ足すだけ。viewBox は 32 固定・strokeWidth 2.4。
const NAV_ICON_PATHS = {
  search: (
    <>
      <circle cx="14.5" cy="14.5" r="9.5" />
      <path d="M21.5 21.5 27.5 27.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4.5" y="6.5" width="23" height="21" rx="3.5" />
      <path d="M4.5 13h23" />
      <path d="M11 3.5v5" />
      <path d="M21 3.5v5" />
    </>
  ),
  today: (
    <>
      <circle cx="16" cy="16" r="11.5" />
      <path d="M16 9.5V16l4.5 3" />
    </>
  ),
  // 応募者（農家ナビ・2026-08-22）：前後2人のアウトライン＝「人が来ている」を線画で表す
  applicants: (
    <>
      <circle cx="12" cy="11" r="5" />
      <path d="M3.5 27.5c1.5-4.9 4.9-7.5 8.5-7.5s7 2.6 8.5 7.5" />
      <path d="M20.5 6.5a5 5 0 0 1 0 9" />
      <path d="M23.5 20.3c2.6 1 4.6 3.5 5.5 7.2" />
    </>
  ),
  chats: (
    <path d="M27.5 9a3.5 3.5 0 0 0-3.5-3.5H8A3.5 3.5 0 0 0 4.5 9v10A3.5 3.5 0 0 0 8 22.5h3.5v6l7-6H24a3.5 3.5 0 0 0 3.5-3.5z" />
  ),
  // 入れ方（訪問者ナビ・2026-08-22）：スマホの枠＋中へ落ちる下矢印＝「端末に入れる」を線画で表す
  install: (
    <>
      <rect x="9" y="3.5" width="14" height="25" rx="3" />
      <path d="M16 9.5v8" />
      <path d="M12.5 14.5 16 18l3.5-3.5" />
      <path d="M14 24h4" />
    </>
  ),
  // 登録・ログイン（訪問者ナビ・2026-08-22）：鍵＝旧🔑の線画版
  login: (
    <>
      <circle cx="10" cy="21.5" r="6" />
      <path d="M14.5 17 27 4.5" />
      <path d="M22.5 9l4.5 4.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="16" cy="10.5" r="5.5" />
      <path d="M5 27.5c1.7-5.4 6-8.5 11-8.5s9.3 3.1 11 8.5" />
    </>
  ),
};

export function NavIcon({ name, size = 26 }) {
  const paths = NAV_ICON_PATHS[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}
