import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountHolderForm} from '../../src/components/AccountHolderForm.jsx';
createRoot(document.getElementById('root')).render(<AccountHolderForm onDone={()=>window.qaDone++} onShowTerms={()=>{}} onShowPrivacy={()=>{}}/>);
