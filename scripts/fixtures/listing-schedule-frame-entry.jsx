import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ListingHeader, ListingFooter } from '../../src/features/jobs/create/components/ListingFrame';
import { ListingPage } from '../../src/features/jobs/create/components/ListingPage';
import { StepSchedule, StepHolidays, StepHeadcount } from '../../src/features/jobs/create/components/StepSchedule';
import { CSS } from '../../src/appStyles';
import '../../src/index.css';
import '../../src/features/jobs/create/listingFlow.css';
function Fixture() {
  const [page,setPage]=useState('schedule');
  const [start,setStart]=useState(new Date(2026,10,1));
  const [end,setEnd]=useState(new Date(2026,10,5));
  const [holidays,setHolidays]=useState(['2026-11-03']);
  const [count,setCount]=useState('3');
  window.qaPage=setPage;
  return <><style>{CSS}</style><div className="job-listing-flow f-sans" style={{position:'fixed',inset:0,display:'flex',flexDirection:'column',background:'#fff'}}>
    <ListingHeader step={page} onSave={()=>{}} onExit={()=>{}} />
    <div className="listing-scroll"><ListingPage step={4} pageId={page}>
      <p className="listing-stage-caption">ステップ1 / 3 · 基本情報</p>
      {page==='schedule' && <StepSchedule {...{start,end,setStart,setEnd,holidays}} />}
      {page==='holidays' && <StepHolidays {...{start,end,holidays,setHolidays}} onEditSchedule={()=>setPage('schedule')} />}
      {page==='headcount' && <StepHeadcount {...{count,setCount}} />}
    </ListingPage></div>
    <ListingFooter step={page} canNext onNext={()=>{}} onBack={()=>{}} />
  </div></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
