// 面接の質問集（分割・大物②・2026-07-24）：初期テンプレとデフォルト投入。ChatViewの＋シートと管理モーダルで共用。
import { supabase } from "./supabase";

// 面接の質問集・初期テンプレ（2026-07-23）：コピーして使う形で提示（編集自由・押し付けない）
export const INTERVIEW_TEMPLATES = [
  { title:"経験の確認", questions:["この作業の経験はありますか？", "一番近い経験を教えてください"] },
  { title:"体と装備",   questions:["長靴・帽子はお持ちですか？", "暑さ・寒さの中の作業は大丈夫ですか？"] },
  { title:"日程の確認", questions:["当日の集合時間に間に合いますか？", "連続の日程は可能ですか？"] },
];

// 面接の質問集を初回だけデフォルト3種で用意する（2026-07-23）。返り値＝現在のセット一覧（created_at昇順）。
// 一度でも用意/保有したら端末ローカルに印を付け、以後は自動投入しない＝「全部消した人」に押し付けない。
export async function ensureDefaultQuestionSets(uid) {
  const fetchList = async () => {
    const { data } = await supabase.from("farmer_question_sets").select("*").eq("farmer_id", uid).order("created_at", { ascending: true });
    return data || [];
  };
  let list = await fetchList();
  const key = "cb_qsetsSeeded_" + uid;
  let seeded = false;
  try { seeded = !!localStorage.getItem(key); } catch {}
  if (list.length === 0 && !seeded) {
    try {
      await supabase.from("farmer_question_sets").insert(INTERVIEW_TEMPLATES.map(t => ({ farmer_id: uid, title: t.title, questions: t.questions })));
      list = await fetchList();
    } catch {}
  }
  try { localStorage.setItem(key, "1"); } catch {}
  return list;
}
