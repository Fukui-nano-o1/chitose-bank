// エラーを運営チャットに投函する（2026-08-16たきと指示「画面上部にエラーを表示するの撤回する。
// 代わりにチャットに貼ってくれ」）＝2026-08-07の管理者帯（AdminErrorStrip）の置き換え。
//
// 【この部品は画面に何も描かない】管理者の端末でだけ走り、新しく出た種類のエラーの報告文を
// 自分の運営DMスレッド（admin_messages・user_id=自分）へ1通ずつ投函する。
// 投函された報告文は、そのままAIや開発者に貼れる自己完結のテキスト（buildErrorReport）。
//
// ★利用者のスレッドには一切書かない（たきと指示「利用者に見える形は不信感を抱くから非表示」）。
//   利用者の端末で起きたエラーも対象にするthat、投函先は【運営者自身のスレッド1本だけ】＝
//   利用者の画面にエラーの話は出ない。DB側も二重の壁：admin_messagesのINSERTポリシーは
//   from_admin=true を app_admins に限る＝一般利用者の端末からは書き込めない。
//
// 【投函の作法】
//  ・アプリを開いた時に1回だけ走る（常駐しない・書き込みを連発しない）
//  ・対象は「未解決」かつ「直近7日に発生した」種類だけ（古い残骸で埋めない）
//  ・同じ種類は7日に1通まで（本文末尾の符牒 #err:xxxx で判定）＝連発しても1通
//  ・1回の起動で最大2通（重大→注意→不明の順・同じ重要度は新しい順）
//  ・取得に失敗したら何もしない（res.error で上書き・投函しない＝2026-08-07フェイルオープン規則）
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { groupAppErrors, explainError, buildErrorReport, errorSigHash } from "../lib/errorCatalog";

const WINDOW_DAYS = 7;      // 拾う窓＝直近7日の未解決
const MAX_PER_OPEN = 2;     // 1回の起動で投函する上限
const SEV_RANK = { high: 0, medium: 1, unknown: 2 };
const MARK = "#err:";       // 本文末尾の符牒（二度貼り防止の目印）

export function AdminErrorChatReporter() {
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const uid = session.user.id;
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        // ① 直近7日の未解決を取る（app_errorsのSELECTは管理者のみ＝RLSthat壁）
        const res = await supabase.from("app_errors")
          .select("id,created_at,source,page,url,component,action,operation,error_code,message,status,user_id,user_agent")
          .eq("status", "open").gte("created_at", since)
          .order("created_at", { ascending: false }).limit(300);
        if (res.error || !res.data?.length) return;

        // ② 既に投函済みの符牒を集める（自分のスレッドの直近7日ぶん）
        const posted = await supabase.from("admin_messages")
          .select("body").eq("user_id", uid).eq("from_admin", true).gte("created_at", since);
        if (posted.error) return;   // 分からない時は投函しない（重複投函より無投函を選ぶ）
        const seen = new Set();
        for (const m of posted.data || []) {
          for (const s of String(m.body || "").matchAll(/#err:([0-9a-z]+)/g)) seen.add(s[1]);
        }

        // ③ 重大→注意→不明、同じ重要度は新しい順に並べ、まだ貼っていない種類を上から
        const flat = [];
        for (const c of groupAppErrors(res.data)) for (const g of c.groups) flat.push({ c, g });
        flat.sort((a, b) =>
          (SEV_RANK[a.c.severity] - SEV_RANK[b.c.severity]) ||
          (new Date(b.g.latest.created_at) - new Date(a.g.latest.created_at)));

        let sent = 0;
        for (const { c, g } of flat) {
          if (sent >= MAX_PER_OPEN) break;
          const mark = errorSigHash(g.sig);
          if (seen.has(mark)) continue;

          // スタックは最新1件だけ（一覧では取らない＝重くしない。取れなくても投函は続ける）
          let stack = "";
          const sres = await supabase.from("app_errors").select("stack").eq("id", g.latest.id).maybeSingle();
          if (!sres.error && sres.data?.stack) stack = sres.data.stack.split("\n").slice(0, 15).join("\n");

          const body = buildErrorReport(g, c.l, explainError(g.latest), stack)
            + "\n\n" + "https://www.chitose-bank.com/#/admin/system"
            + "\n" + MARK + mark;
          const ins = await supabase.from("admin_messages").insert({ user_id: uid, from_admin: true, body });
          if (ins.error) return;    // 権限・通信で失敗したら以降も同じso止める
          seen.add(mark);
          sent++;
        }
      } catch { /* 投函は補助機能＝失敗しても画面には影響させない */ }
    })();
  }, []);
  return null;
}
