import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobHostRow,JobWorkplaceIntro,JobReviewsAndHost} from '../../src/features/jobs/search/components/JobDetailPanel.jsx';
import {openWorkplace,returnFromWorkplace} from '../../src/features/jobs/search/workplace.js';
const root=createRoot(document.getElementById('root'));
window.qaReturnWorkplace=()=>returnFromWorkplace(101);
window.qaRenderHost=({employer,preview=false,interactive=true,both=false,jobId=101})=>flushSync(()=>root.render(<main>
 <JobHostRow job={{employerName:'Synthetic host'}} employer={employer} onOpenWorkplace={interactive&&(!preview||both)?()=>{throw Error("Host invoked workplace callback");}:undefined} onOpenIntro={preview?()=>window.qaPreview++:undefined}/>
 <JobWorkplaceIntro employer={employer} status="ready" photoStatus="ready" photos={[]} onOpenWorkplace={()=>{window.qaWorkplace++;openWorkplace(101);}}/>
 <JobReviewsAndHost job={{id:jobId}} employer={employer} me={null} onOpenWorkplace={interactive&&(!preview||both)?()=>{throw Error("Host card invoked workplace callback");}:undefined} onOpenIntro={preview?()=>window.qaPreview++:undefined}/>
</main>));
window.qaRenderHost(window.qaProps);
