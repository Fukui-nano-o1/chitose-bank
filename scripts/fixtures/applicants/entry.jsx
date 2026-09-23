import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ApplicantCard } from '../../../src/features/farmer/dashboard/ApplicantCard';
import { FarmerDashboard } from '../../../src/components/FarmerDashboard';
import { CSS } from '../../../src/appStyles';

const root = createRoot(document.getElementById('root'));
const actions = Object.fromEntries(['OpenWorker', 'OpenJob', 'OpenDetails', 'Chat', 'Hire', 'Insurance', 'Review', 'Report', 'Notice']
  .map(name => [`on${name}`, value => window.qaActions.push({ name, value })]));
window.qaRender = () => flushSync(() => root.render(<><style>{CSS}</style>{window.qaDashboard
  ? <FarmerDashboard me={window.qaMe} />
  : window.qaCards.map(props => <ApplicantCard key={props.application?.id || 'empty'} {...props} {...actions}
      progress={<p>掲載・承認・面接・採用・仕事・評価</p>} />)}</>));
window.qaRender();
