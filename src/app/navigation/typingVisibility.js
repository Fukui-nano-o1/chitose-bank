// 入力中のモバイルナビ非表示クラスを所有する。認証・権限・表示ゲートは変更しない。
export function installTypingVisibility() {
  const isTextField = (el) => {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"].includes((el.type || "text").toLowerCase());
    return el.isContentEditable === true;
  };
  let timer = null;
  let focusedField = null;
  // Reactがログイン画面等の入力欄を削除するとfocusoutが発火しないことがある。
  // 入力中だけDOMの削除を監視し、消えた欄がcb-typingを残さないようにする。
  const observer = new MutationObserver(() => {
    if (focusedField && !focusedField.isConnected) syncFocus();
  });
  function syncFocus() {
    const active = document.activeElement;
    focusedField = isTextField(active) ? active : null;
    document.body.classList.toggle("cb-typing", !!focusedField);
    observer.disconnect();
    if (focusedField) observer.observe(document.body, { childList: true, subtree: true });
  }
  const onFocusIn = () => {
    if (!isTextField(document.activeElement)) return;
    if (timer) { clearTimeout(timer); timer = null; }
    syncFocus();
  };
  const onFocusOut = () => {
    if (timer) clearTimeout(timer);
    // 入力欄間の切替では下部バーをちらつかせない。
    timer = setTimeout(() => { timer = null; syncFocus(); }, 120);
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  syncFocus();
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    if (timer) clearTimeout(timer);
    observer.disconnect();
    focusedField = null;
    document.body.classList.remove("cb-typing");
  };
}
