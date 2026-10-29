import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JobSearchMapView } from '../../../src/features/jobs/search/JobSearchMapView';
import { orderSearchJobs } from '../../../src/features/jobs/search/searchJobs';
import { mapJobPublicRow } from '../../../src/lib/utils';

window.qaOrderSearchJobs = orderSearchJobs;
window.qaMapJobPublicRow = mapJobPublicRow;

// The first commit is observed synchronously to catch a flash of stale jobs,
// before any request has a chance to resolve.
flushSync(() => {
  createRoot(document.getElementById('root')).render(<JobSearchMapView me={window.qaMe || null} />);
});
window.qaMounted = true;
