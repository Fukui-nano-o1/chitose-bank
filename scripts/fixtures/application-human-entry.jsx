import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ApplicationPage } from '../../src/features/jobs/search/components/ApplicationPage.jsx';
const root = createRoot(document.getElementById('root'));
window.qaRenderApplication = props => flushSync(() => root.render(<ApplicationPage key={props.fixtureKey || 'application'} {...props} />));
