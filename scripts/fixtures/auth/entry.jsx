import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoginScreen } from '../../../src/components/LoginScreen';
import { ProfileHub } from '../../../src/components/ProfileHub';

createRoot(document.getElementById('root')).render(window.qaProfile
  ? <ProfileHub me={{ id: 'fixture-user', email: 'person@fixture.test' }} onLogout={() => { window.qaLoggedOut = true; }} />
  : <LoginScreen onLogin={() => { window.qaLoggedIn = true; }} />);
