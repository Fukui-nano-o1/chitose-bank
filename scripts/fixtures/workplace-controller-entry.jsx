import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorkplaceEditor} from '../../src/components/WorkplaceEditor.jsx';
const root=createRoot(document.getElementById('root'));
window.qaController=me=>flushSync(()=>root.render(<WorkplaceEditor me={me} onBack={()=>{}} />));
window.qaController(window.qaMe);
