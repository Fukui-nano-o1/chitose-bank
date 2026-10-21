import { inputRecovery } from '../lib/inputRecovery.js';

export function ProfileReadError({ onRetry, message }) {
  return <div role="alert" className="f-sans" style={{ padding:20, lineHeight:1.7 }}>
    <p>{message || inputRecovery('PROFILE_READ').message}</p>
    <button type="button" className="btn-primary f-sans" onClick={onRetry}>もう一度読み込む</button>
  </div>;
}
