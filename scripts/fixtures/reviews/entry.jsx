import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkerReviewSheet } from '../../../src/components/WorkerReviewSheet';
import { FinalReviewSheet } from '../../../src/components/FinalReviewSheet';
import { ReceivedReviews } from '../../../src/components/ReceivedReviews';
import { FARMER_TRAIT_TAGS } from '../../../src/lib/reviewCatalog';
import { MyReviewsOfWorker } from '../../../src/components/MyReviewsOfWorker';

function Harness() {
  const [app, setApp] = useState({ id:'application-a', farmer_id:'farmer-a' });
  const [answers, setAnswers] = useState({});
  const [tags, setTags] = useState([]);
  const [meId, setMeId] = useState('worker-a');
  window.qaSetApp = setApp;
  window.qaSetMeId = setMeId;
  const onDone = id => { window.qaDone.push(id); };
  if (window.qaMode === 'own') return <MyReviewsOfWorker workerId="reviewed-worker" />;
  if (window.qaMode === 'badges') return <ReceivedReviews direction={window.qaDirection || 'worker_to_farmer'} showAllItems={window.qaShowAll} preloaded={window.qaBadges} />;
  if (window.qaMode === 'farmer-expanded') return <FinalReviewSheet app={app} title="今回の仕事を完了する" questions={[
    { k:'work_outcome', label:'仕事は完了しましたか', choices:[{v:'completed',l:'予定どおり完了'},{v:'partial',l:'一部完了'}] },
    { k:'want_again_choice', label:'またこの人と働きたいですか', choices:[{v:'yes',l:'はい'},{v:'neutral',l:'どちらともいえない'}] },
  ]} answers={answers} onAnswer={(k,v)=>setAnswers(prev=>({...prev,[k]:v}))}
    tagDef={FARMER_TRAIT_TAGS} tags={tags} onToggleTag={tag=>setTags(prev=>prev.includes(tag)?prev.filter(t=>t!==tag):[...prev,tag])}
    onSubmit={()=>{ window.qaInserts.push({ ...answers, traits:tags }); onDone(app.id); }} onClose={()=>setApp(null)} />;
  if (window.qaMode === 'farmer') return <FinalReviewSheet app={app} title="働き手のふりかえり" questions={[
    { k:'completed', label:'予定の仕事は完了しましたか', choices:[{ v:'yes',l:'完了した' },{ v:'no',l:'完了しなかった' }] },
  ]} answers={answers} onAnswer={(k,v)=>setAnswers(prev=>({...prev,[k]:v}))} onSubmit={()=>onDone(app.id)} onClose={()=>setApp(null)} />;
  return <WorkerReviewSheet app={app} meId={meId} onDone={onDone} onClose={()=>setApp(null)} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
