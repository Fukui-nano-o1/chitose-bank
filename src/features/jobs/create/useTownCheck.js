// 住所（都道府県＋市区町村＋町域）が実在するかを、入力が落ち着いてから確かめるフック（2026-09-27）。
// 返り値：
//   "idle"     … 欄が空・対象外の都道府県＝確かめない
//   "checking" … 問い合わせ中（入力は止めない）
//   "ok"       … 見つかった
//   "notfound" … 見つからない＝入力エラー（呼び出し側が赤字で説明し「次へ」を止める）
//   "error"    … 通信で確かめられなかった＝止めない（フェイルオープン）
// 求人フロー（LandingFlow の集合場所）と作業場の登録（WorkplacePage）が同じフックを使う。
import { useEffect, useState } from "react";
import { verifyTownAddress } from "./jobCreateGeo";
import { isAllowedPrefecture } from "./model";

export function useTownCheck(prefecture, city, town, delayMs = 700) {
  const p = (prefecture || "").trim(), c = (city || "").trim(), t = (town || "").trim();
  const key = p && c && t && isAllowedPrefecture(p) ? `${p}|${c}|${t}` : "";
  const [state, setState] = useState({ key: "", status: "idle" });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState({ key, status: "checking" });
      const status = await verifyTownAddress(p, c, t);
      if (!cancelled) setState({ key, status });
    }, delayMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return "idle";
  // 入力を変えた直後（まだ確かめていない）は前の結果を使わない
  return state.key === key ? state.status : "checking";
}

// 赤字・灰字の説明（呼び出し側で共通に使う文言）
export const TOWN_NOT_FOUND_MESSAGE =
  "この住所が見つかりませんでした。町域の表記を確かめてください（郵便番号の「住所を検索」で入れ直すと確実です）。見つからない住所では、働き手が地図で場所を確かめられません";
export const TOWN_CHECK_ERROR_MESSAGE =
  "通信の都合で住所を確かめられませんでした。このまま進めます";
