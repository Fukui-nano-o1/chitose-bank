import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedbackModal } from '../../../src/app/diagnostics/FeedbackModal';

function Harness() {
  const [open, setOpen] = useState(window.qaOpen !== false);
  const [userId, setUserId] = useState(window.qaUserId ?? null);
  window.qaSetUserId = value => { window.qaUserId = value; setUserId(value); };
  window.qaSetOpen = setOpen;
  return <>
    <label>元の画面の入力<input id="underlying-draft" defaultValue="求人の入力途中です" /></label>
    <button id="support-trigger" onClick={() => setOpen(true)}>ヘルプを開く</button>
    <FeedbackModal open={open} userId={userId} initialRequest={window.qaInitialRequest}
      onClose={() => { window.qaCloseCount = (window.qaCloseCount || 0) + 1; setOpen(false); }} />
  </>;
}

createRoot(document.getElementById('root')).render(<Harness />);
