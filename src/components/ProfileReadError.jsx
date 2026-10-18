export function ProfileReadError({ onRetry }) {
  return <div role="alert" className="f-sans" style={{ padding:20, lineHeight:1.7 }}>
    <p>保存済みの情報を読み込めませんでした。内容を確認できるまで保存できません。</p>
    <button type="button" className="btn-primary f-sans" onClick={onRetry}>もう一度読み込む</button>
  </div>;
}
