import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {StepDanger} from '../../src/features/jobs/create/components/StepDanger';
import {StepPhotos} from '../../src/features/jobs/create/components/StepPhotos';
function QA(){
 const [places,setPlaces]=useState([{label:'場所',desc:'説明',photos:[]},{label:'',desc:'',photos:[]}]);
 const [tasks,setTasks]=useState([{label:'作業',desc:'説明',photos:[]},{label:'',desc:'',photos:[]}]);
 const [photos,setPhotos]=useState(window.qaInitialPhotos||[]),[busy,setBusy]=useState(false),[p2,setP2]=useState(false),[t2,setT2]=useState(false),[job,setJob]=useState(17),[visible,setVisible]=useState(true);
 useEffect(()=>{window.qaCommitted={job,visible};},[job,visible]);
 window.qaState={places,tasks,photos,busy};window.qaSetJob=setJob;window.qaHide=()=>setVisible(false);window.qaSetPhotos=setPhotos;
 return <><button id="next" disabled={busy}>次へ</button>{visible&&(window.qaMode==='danger'?<StepDanger jobDangerPlaces={places} setJobDangerPlaces={setPlaces} jobDangerTasks={tasks} setJobDangerTasks={setTasks} showPlace2={p2} setShowPlace2={setP2} showTask2={t2} setShowTask2={setT2} photoUploading={busy} setPhotoUploading={setBusy} ownerId="owner" currentJobNumber={job}/>:<StepPhotos jobPhotos={photos} setJobPhotos={setPhotos} photoUploading={busy} setPhotoUploading={setBusy} ownerId="owner" currentJobNumber={job}/>)}</>;
}
createRoot(document.getElementById('root')).render(<QA/>);
