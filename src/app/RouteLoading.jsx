// ナビを残したまま、読み込む領域だけをつなぐ。全画面を白紙へ戻さない。
export function RouteLoading() {
  return (
    <div role="status" aria-label="画面を読み込んでいます" style={{ padding:"24px 0", minHeight:320 }}>
      <div aria-hidden="true" style={{ display:"grid", gap:18 }}>
        <div className="ghost-line" style={{ width:"42%", height:24, borderRadius:6 }} />
        {[0, 1, 2].map(i => <div key={i} className="ghost-line" style={{ height:88, borderRadius:12 }} />)}
      </div>
    </div>
  );
}
