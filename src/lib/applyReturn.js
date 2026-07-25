// 分割3-C（2026-07-25）：App.jsxから移動。応募導線の「戻り先求人」記録（localStorage）。
// 未ログイン応募→登録→元の求人へ戻る／プロフィール未完→編集→元の求人へ戻る、の2導線で共用。
const APPLY_RETURN_KEY = 'applyReturnJob';
export const peekApplyReturn  = () => { try { return localStorage.getItem(APPLY_RETURN_KEY); } catch { return null; } };
export const setApplyReturn   = (n) => { try { localStorage.setItem(APPLY_RETURN_KEY, String(n)); } catch {} };
export const clearApplyReturn = () => { try { localStorage.removeItem(APPLY_RETURN_KEY); } catch {} };
