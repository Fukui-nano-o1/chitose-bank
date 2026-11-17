import {PrivacyPage} from '../../src/app/legal/LegalPages.jsx';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AnalyticsPreferences} from '../../src/components/AnalyticsPreferences.jsx';
const root=createRoot(document.getElementById('root'));
window.renderPreferences=props=>flushSync(()=>root.render(<AnalyticsPreferences {...props}/>));
window.renderPreferences({always:true});

window.renderPrivacy=()=>flushSync(()=>root.render(<PrivacyPage/>));
