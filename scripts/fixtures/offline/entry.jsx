import React, {useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {LandingFlow} from '../../../src/features/jobs/create/LandingFlow';
import PrivacyReconsent from '../../../src/components/PrivacyReconsent';
import {PendingConsentWorkspace} from '../../../src/components/PendingConsentWorkspace';
import {DeviceDrafts} from '../../../src/components/DeviceDrafts';
import {useDeviceSync} from '../../../src/hooks/useDeviceSync';
import * as drafts from '../../../src/lib/deviceDrafts';
import {PRIVACY_VERSION} from '../../../src/lib/utils';
import {owner} from './client';
window.qaDrafts = drafts;
const scenario = new URLSearchParams(location.search).get('case');
if (scenario === 'new') {
  const form = {role:'farmer',farmerStep:8,farmerCropPill:'ブロッコリー',farmerTaskPill:'収穫',farmerPurpose:'post',
    farmerZip:'7793401',farmerPref:'徳島県',farmerCity:'吉野川市',farmerTown:'山川町',farmerAddr:'テスト',jobDateStart:'2026-11-01T00:00:00+09:00',
    jobCount:'3',dailyWageInput:'10000',breakTime:'60分',overtimePolicy:'なし',jobDescription:'最初の入力'};
  const record = drafts.saveDeviceDraft(drafts.newDeviceDraft(owner),form,{notes:form.jobDescription});
  drafts.activeDeviceDraft(owner,record.id);
}
function App() {
  const [gate,setGate] = useState(scenario === 'consent');
  const [done,setDone] = useState('');
  const confirmed = useCallback(() => setGate(false),[]);
  const sync = useDeviceSync(owner,PRIVACY_VERSION,confirmed);
  return gate ? sync.pending ? <PendingConsentWorkspace owner={owner} error={sync.error} onRetry={sync.retry} onNewJob={()=>setDone('draft')} />
    : <PrivacyReconsent authId={owner} onPending={sync.retry} onAgreed={confirmed} onShowPrivacy={()=>{}} />
    : scenario === 'consent' ? <h1>同意確認済み</h1>
    : done ? <><h1>{done}</h1><DeviceDrafts owner={owner} /></>
    : <LandingFlow ownerId={owner} initialRole="farmer" localOnly={window.qaLocalOnly || false}
      initialStep={Number(location.hash.split('/').pop()) || undefined}
      onDraftSaved={()=>{location.hash='/profile/employer/drafts';setDone('保存して終了しました');}}
      onSkip={()=>setDone('終了しました')} onPublished={()=>setDone('掲載完了')} onLogin={()=>setDone('ログイン')} />;
}
createRoot(document.getElementById('root')).render(<App />);
