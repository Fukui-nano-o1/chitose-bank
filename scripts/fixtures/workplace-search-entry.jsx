import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobSearchMapView} from '../../src/features/jobs/search/JobSearchMapView.jsx';
const root = createRoot(document.getElementById('root'));
window.qaRenderSearch = me => flushSync(() => root.render(<JobSearchMapView me={me} />));
window.qaRenderSearch(null);
