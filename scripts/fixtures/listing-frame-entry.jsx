import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ListingHeader, ListingFooter } from '../../src/features/jobs/create/components/ListingFrame.jsx';
import { ListingPage } from '../../src/features/jobs/create/components/ListingPage.jsx';
function Fixture() {
  const [state, setState] = useState({step:0,revision:0});
  window.qaRender = p => setState(old => ({...p,revision:old.revision+1}));
  const action = name => () => window.qaEvents.push(name);
  return <div data-revision={state.revision}>
    <ListingHeader step={state.step} saving={state.saving} busy={state.busy} onSave={state.noSave ? undefined : action('save')} onExit={action('exit')} />
    <ListingPage step={state.step} isFarmer={state.isFarmer ?? true} embedded={state.embedded} stepAnim={state.stepAnim}>
      <h2>共通ページ</h2><input aria-label="入力欄" defaultValue="入力内容" />
    </ListingPage>
    <ListingFooter {...state} canNext={state.canNext ?? true} onNext={action('next')} onBack={action('back')} onSkipDetails={action('skip')} onPublish={action('publish')} />
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
