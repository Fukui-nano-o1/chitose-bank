// チャット一覧のキャッシュ（分割・大物②・2026-07-24）：一覧(ChatList)⇄スレッド(ChatView)間で共有。
// ESMのimportバインディングは再代入不可のため、箱(box)方式で共有する。
// 2026-08-07（たきと指示「遷移した時も遅い。はじめは最低限の要素のみ表示」）：
// 一覧の骨だけviewCache（localStorage・本人スコープ）にも置き、冷間起動でも前回の一覧を即描画する。
// ★保存するのは応募行＋相手名＋求人名＋未読数＋時刻のみ。メッセージ本文は一切含まれない
// ＝「本文は端末に永続させない」（2026-08-02規則・2026-07-19履歴保全）は不変。
// 表示専用（権限・書き込みの正には使わない）・ログアウトのclearSnapshots→clearCacheで消える。
import { getCache, setCache } from "./viewCache";

export const chatCache = { v: null }; // v = { rows, unreadMap, initialsMap, lastMsgMap }

// 冷間復元：メモリが空（アプリ再起動後）ならviewCacheから骨を戻す。一覧・スレッドの両入口から呼ぶ
export const hydrateChatCache = () => {
  if (!chatCache.v) {
    const c = getCache("chatList");
    if (c && typeof c === "object" && !Array.isArray(c) && Array.isArray(c.rows)) chatCache.v = c;
  }
  return chatCache.v;
};

// 保存：chatCache.vを更新した側（ChatListの保存effect）が呼ぶ
export const persistChatCache = () => { if (chatCache.v) setCache("chatList", chatCache.v); };
