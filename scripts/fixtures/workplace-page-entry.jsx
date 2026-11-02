import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorkplacePage} from '../../src/features/jobs/search/components/WorkplacePage.jsx';
const root = createRoot(document.getElementById('root'));
window.qaBackCount = 0;
window.qaRenderWorkplace = props => flushSync(() => root.render(
  <WorkplacePage {...props} onBack={() => { window.qaBackCount++; }} />
));
window.qaRenderWorkplace(window.qaWorkplaceProps);
