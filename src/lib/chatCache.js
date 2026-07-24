// チャット一覧のメモリキャッシュ（分割・大物②・2026-07-24）：一覧(App内ChatsList)⇄スレッド(ChatView)間で共有。
// ESMのimportバインディングは再代入不可のため、箱(box)方式で共有する。リロードで消える揮発キャッシュ。
export const chatCache = { v: null }; // v = { rows, unreadMap, initialsMap }
