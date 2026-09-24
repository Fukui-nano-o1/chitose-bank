import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkerReviewSheet } from '../../../src/components/WorkerReviewSheet';
import { FinalReviewSheet } from '../../../src/components/FinalReviewSheet';
import { ReceivedReviews } from '../../../src/components/ReceivedReviews';

function Harness() {
  const [app, setApp] = useState({ id:'application-a', farmer_id:'farmer-a' });
  const [answers, setAnswers] = useState({});
  window.qaSetApp = setApp;
  const onDone = id => { window.qaDone.push(id); };
  if (window.qaMode === 'badges') return <ReceivedReviews direction="worker_to_farmer" showAllItems={window.qaShowAll} preloaded={window.qaBadges} />;
  if (window.qaMode === 'farmer') return <FinalReviewSheet app={app} title="働き手のふりかえり" questions={[
    { k:'completed', label:'予定の仕事は完了しましたか', choices:[{ v:'yes',l:'完了した' },{ v:'no',l:'完了しなかった' }] },
  ]} answers={answers} onAnswer={(k,v)=>setAnswers(prev=>({...prev,[k]:v}))} onSubmit={()=>onDone(app.id)} onClose={()=>setApp(null)} />;
  return <WorkerReviewSheet app={app} meId="worker-a" onDone={onDone} onClose={()=>setApp(null)} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
