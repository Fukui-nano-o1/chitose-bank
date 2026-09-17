// 画面表示と先読みで同じ import を共有する。失敗は保持しないので、オフライン後も再試行できる。
export function createModuleLoader(factory) {
  let pending;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(factory).catch(error => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}
