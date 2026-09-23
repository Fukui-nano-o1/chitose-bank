import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalyticsPreferences, ProductAnalyticsController } from '../../../src/components/AnalyticsPreferences';
import { AdminAnalyticsRoom } from '../../../src/components/admin/AdminAnalyticsRoom';
import { productAnalytics } from '../../../src/lib/productAnalytics';
import { applyToJob } from '../../../src/features/jobs/search/jobSearchApi';
window.qaAnalytics = productAnalytics;
window.qaApply = () => applyToJob(1311,['2026-09-24']);
function Fixture() {
  const [settings,setSettings] = useState(false), [admin,setAdmin] = useState(false);
  return <><ProductAnalyticsController excluded={admin}/><button onClick={() => setSettings(true)}>設定を開く</button><button onClick={() => setAdmin(true)}>管理を開く</button>
    <AnalyticsPreferences always={settings}/>{admin && <AdminAnalyticsRoom/>}</>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
