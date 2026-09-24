// Unsent chat contents stay in memory only. Never put plaintext conversation drafts in web storage.
// Survives route changes within this open app; reload, closing the app, or logout clears it.
const drafts = new Map();
export const readChatDraft = (uid, thread) => drafts.get(`${uid}:${thread}`) || { text: '', pending: null };
export function saveChatDraft(uid, thread, draft) {
  if (!uid || !thread) return;
  const key = `${uid}:${thread}`;
  if (draft.text || draft.pending) drafts.set(key, { ...draft });
  else drafts.delete(key);
}
export const clearChatDrafts = () => drafts.clear();
