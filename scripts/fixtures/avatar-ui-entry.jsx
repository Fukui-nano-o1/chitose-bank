import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkerProfileEdit } from '../../src/components/WorkerProfileEdit';
import { EmployerProfileEdit } from '../../src/components/EmployerProfileEdit';
import { uid } from './avatar-client.mjs';
createRoot(document.getElementById('root')).render(window.qaRole === 'worker'
  ? <WorkerProfileEdit me={{ id: uid }} onAvatarChange={value => window.qaChanges.push(value)} />
  : <EmployerProfileEdit me={{ id: uid }} />);
