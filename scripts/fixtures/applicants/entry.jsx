import React, { useEffect, useState } from 'react';
import { readLaborNoticeRoute } from '../../../src/lib/laborNoticeRoute';
import LaborConditionsNotice from '../../../src/components/LaborConditionsNotice';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ApplicantCard } from '../../../src/features/farmer/dashboard/ApplicantCard';
import { FarmerDashboard } from '../../../src/components/FarmerDashboard';
import { CSS } from '../../../src/appStyles';

const root = createRoot(document.getElementById('root'));
const actions = Object.fromEntries(['OpenWorker', 'OpenJob', 'OpenDetails', 'Chat', 'Hire', 'Insurance', 'Review', 'Report', 'Notice']
  .map(name => [`on${name}`, value => window.qaActions.push({ name, value })]));
function Dashboard() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const notice = readLaborNoticeRoute(hash);
  return notice ? <LaborConditionsNotice key={hash} me={window.qaMe} {...notice} /> : <FarmerDashboard me={window.qaMe} />;
}
window.qaRender = () => flushSync(() => root.render(<><style>{CSS}</style>{window.qaDashboard
  ? <Dashboard />
  : window.qaCards.map(props => <ApplicantCard key={props.application?.id || 'empty'} {...props} {...actions}
      progress={<p>掲載・承認・面接・採用・仕事・評価</p>} />)}</>));
window.qaRender();
