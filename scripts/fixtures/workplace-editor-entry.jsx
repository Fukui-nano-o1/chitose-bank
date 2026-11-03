import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorkplaceEditPage} from '../../src/components/WorkplaceEditPage.jsx';
const root=createRoot(document.getElementById('root'));
window.qaRenderEditor=props=>flushSync(()=>root.render(<WorkplaceEditPage {...props} />));
window.qaRenderEditor(window.qaEditorProps);
