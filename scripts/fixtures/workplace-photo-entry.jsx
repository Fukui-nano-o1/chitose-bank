import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorkplacePhoto} from '../../src/components/WorkplacePhoto.jsx';
const root=createRoot(document.getElementById('root'));
window.qaWorkplacePhoto=path=>flushSync(()=>root.render(path===null?null:<WorkplacePhoto path={path} alt="独立した職場写真" />));
window.qaWorkplacePhoto(window.qaPhotoPath);
