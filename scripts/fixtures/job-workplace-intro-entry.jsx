import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobHostRow, JobWorkplaceIntro, JobHighlights} from '../../src/features/jobs/search/components/JobDetailPanel.jsx';
const root = createRoot(document.getElementById('root'));
window.qaWorkplaceOpen = 0;
window.qaRenderIntro = props => flushSync(() => root.render(<main style={{maxWidth:700, margin:'0 auto', padding:20}}>
  <JobHostRow job={{employerName:'合成農園'}} />
  <JobWorkplaceIntro {...props} onOpenWorkplace={() => { window.qaWorkplaceOpen++; }} />
  <JobHighlights job={{beginnerOk:true,instantApproveRepeat:true,experiencedPreferred:true}} />
</main>));
window.qaRenderIntro(window.qaIntroProps || {});
