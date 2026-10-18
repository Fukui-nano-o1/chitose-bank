import React from 'react';
import {createRoot} from 'react-dom/client';
import {DayReportSheet} from '../../src/components/DayReportSheet.jsx';
import {AttendanceDisputeSheet} from '../../src/components/AttendanceDisputeSheet.jsx';
import {uid,applicationId} from './attendance-client.mjs';
const root=createRoot(document.getElementById('root'));
window.qaMount=()=>root.render(window.qaMode==='dispute'
 ? <AttendanceDisputeSheet app={{id:applicationId}} meId={uid} onDone={id=>window.qaDone.push(id)} onClose={()=>window.qaClosed++}/>
 : <DayReportSheet app={{id:applicationId}} meId={uid} role="worker" workDate="2026-10-18" onDone={id=>window.qaDone.push(id)} onClose={()=>window.qaClosed++}/>);
window.qaUnmount=()=>root.render(null);
window.qaMount();
