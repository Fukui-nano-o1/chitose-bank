import React from 'react';
import {createRoot} from 'react-dom/client';
import {HelpCenter,InstallGuide} from '../../src/app/help/HelpCenter.jsx';
import {ADMIN_EMAIL} from '../../src/lib/utils.js';
import {uid} from './help-image-client.mjs';
const Component=window.qaRole==='install'?InstallGuide:HelpCenter;
createRoot(document.getElementById('root')).render(<Component me={{id:uid,email:ADMIN_EMAIL}}/>);
