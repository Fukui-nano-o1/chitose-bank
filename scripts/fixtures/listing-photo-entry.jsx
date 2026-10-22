import React from 'react';
import {createRoot} from 'react-dom/client';
import {ListingPhoto} from '../../src/components/ListingPhoto.jsx';
const root=createRoot(document.getElementById('root'));
window.qaRender=src=>root.render(<ListingPhoto src={src} alt="写真" />);
window.qaRender(window.qaPhotoSource);
