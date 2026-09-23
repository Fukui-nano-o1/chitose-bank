import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminReportsRoom } from '../../../src/components/admin/AdminReportsRoom';

function Fixture() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return hash.startsWith('#/admin/reports') ? <main style={{ padding: '0 24px' }}><AdminReportsRoom /></main>
    : <div>移動先：{hash}<button onClick={() => window.history.back()}>元の案件に戻る</button></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
