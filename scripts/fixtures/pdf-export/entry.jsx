import React from 'react';
import { createRoot } from 'react-dom/client';
import LaborConditionsNotice from '../../../src/components/LaborConditionsNotice';
import { saveElementAsPdf, buildPdf } from '../../../src/lib/pdfExport';

window.qaSavePdf = saveElementAsPdf;
window.qaBuildPdf = buildPdf;
createRoot(document.getElementById('root')).render(<LaborConditionsNotice me={window.qaMe} role="farmer" applicationId={window.qaApplicationId} onClose={() => {}} />);
