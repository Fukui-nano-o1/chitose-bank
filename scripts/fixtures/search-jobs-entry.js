import * as legacy from '../../src/lib/searchJobs.js';
import * as feature from '../../src/features/jobs/search/searchJobs.js';
import { getCache, setCache, clearCache } from '../../src/lib/viewCache.js';
import { emitConfirmedRefresh, REFRESH_JOBS } from '../../src/lib/refreshBus.js';
import { mapJobPublicRow } from '../../src/lib/utils.js';

window.qaSearch = { legacy, feature, getCache, setCache, clearCache, mapJobPublicRow,
  refresh: () => emitConfirmedRefresh(REFRESH_JOBS) };
