import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobCard} from '../../src/components/JobCard.jsx';
import {JobFlagBadges} from '../../src/components/uiPrimitives.jsx';
import {JobHighlights} from '../../src/features/jobs/search/components/JobDetailPanel.jsx';
import {StepWishes} from '../../src/features/jobs/create/components/StepWishes.jsx';
const root = createRoot(document.getElementById('root'));
const noop = () => {};
window.qaRenderRetiredFlags = (expert=false,mode='all') => flushSync(()=>root.render(<main>
  <JobCard job={{id:1,crop:'合成作物',task:'収穫',photos:[],beginnerOk:true,instantApproveRepeat:true,experiencedPreferred:expert}} />
  <JobFlagBadges beginner repeat expert={expert} />
  <JobHighlights job={{beginnerOk:true,instantApproveRepeat:true,experiencedPreferred:expert}} />
  <StepWishes mode={mode} jobNotes="" setJobNotes={noop} jobCautions="" setJobCautions={noop} beginnerOk setBeginnerOk={noop} instantApproveRepeat setInstantApproveRepeat={noop} experiencedPreferred={expert} setExperiencedPreferred={noop} flagInfoOpen="beginner" setFlagInfoOpen={noop} />
</main>));
window.qaRenderRetiredFlags();
