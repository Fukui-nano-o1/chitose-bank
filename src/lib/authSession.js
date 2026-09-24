// SDKと同じ保存キーを明示し、ログアウト後に遅れて返った認証応答で復元されるのを防ぐ。
export function authStorageKey(url) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

export function createAuthStorage(key, getStorage = () => window.localStorage) {
  const memory = new Map();
  const sessionKeys = new Set([key, `${key}-code-verifier`, `${key}-user`]);
  let signedOut = false;
  const storage = {
    getItem(name) {
      if (signedOut && sessionKeys.has(name)) return null;
      try { return getStorage().getItem(name); }
      catch { return memory.get(name) ?? null; }
    },
    setItem(name, value) {
      if (signedOut && sessionKeys.has(name)) return;
      memory.set(name, value);
      try { getStorage().setItem(name, value); } catch { /* 保存不可の端末はメモリだけで利用する */ }
    },
    removeItem(name) {
      memory.delete(name);
      try { getStorage().removeItem(name); } catch { /* メモリの認証状態も必ず消す */ }
    },
  };
  return {
    storage,
    clearSession() {
      signedOut = true;
      for (const name of sessionKeys) storage.removeItem(name);
    },
  };
}

// サーバーの失効処理を試みるが、失敗・例外・認証ロック待ちでもこの端末からは退出する。
// タイムアウトはサーバーでの失効成功を意味しない。端末の消去と区別して返す。
export function createDeviceLogout({
  signOut, stopAutoRefresh, clearAuth, clearPrivateState, navigate,
  timeoutMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let pending;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      let timer;
      let remoteRevoked = false;
      try {
        Promise.resolve().then(stopAutoRefresh).catch(() => {});
        remoteRevoked = await Promise.race([
          Promise.resolve().then(() => signOut({ scope: "global" }))
            .then(result => !result?.error, () => false),
          new Promise(resolve => { timer = setTimer(() => resolve(false), timeoutMs); }),
        ]);
      } finally {
        clearTimer(timer);
        try { clearAuth(); }
        finally {
          try { clearPrivateState(); }
          finally { navigate(); }
        }
      }
      return { remoteRevoked };
    })();
    return pending;
  };
}
