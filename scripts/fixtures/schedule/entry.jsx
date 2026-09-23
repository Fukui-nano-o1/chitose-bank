import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { UpcomingSchedule } from '../../../src/features/today/components/Upcoming';
import { ScheduleDetail } from '../../../src/features/today/components/ScheduleDetail';
import { readScheduleRoute } from '../../../src/features/today/schedule';
import { emitConfirmedRefresh, REFRESH_APPLICATIONS } from '../../../src/lib/refreshBus';

window.qaRefresh = () => emitConfirmedRefresh(REFRESH_APPLICATIONS);
function Fixture() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const route = readScheduleRoute(hash);
  if (route) return <ScheduleDetail key={hash} me={window.qaMe} {...route} />;
  if (hash.startsWith('#/chat/')) return <p>チャットへの遷移を確認</p>;
  if (hash.startsWith('#/work/job/')) return <p>求人への遷移を確認</p>;
  return <UpcomingSchedule role={hash.includes('/employer') ? 'farmer' : 'worker'} />;
}
flushSync(() => createRoot(document.getElementById('root')).render(<Fixture />));
