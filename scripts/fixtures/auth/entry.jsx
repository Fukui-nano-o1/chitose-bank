import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginScreen } from '../../../src/components/LoginScreen';
import { ProfileHub } from '../../../src/components/ProfileHub';
import { AccountHolderForm } from '../../../src/components/AccountHolderForm';
import { clearLegacyPageCache } from '../../../src/app/browserStartup';

void clearLegacyPageCache();

function RegistrationJourney() {
  const [verified, setVerified] = useState(false);
  return verified
    ? <AccountHolderForm onDone={() => { window.qaRegistrationDone = (window.qaRegistrationDone || 0) + 1; }} onShowTerms={() => {}} onShowPrivacy={() => {}} />
    : <LoginScreen onLogin={user => { window.qaLoggedIn = user; setVerified(true); }} />;
}

createRoot(document.getElementById('root')).render(window.qaProfile
  ? <ProfileHub me={{ id: 'fixture-user', email: 'person@fixture.test' }} onLogout={() => { window.qaLoggedOut = true; }} />
  : window.qaCompleteRegistration ? <RegistrationJourney />
  : <LoginScreen onLogin={user => { window.qaLoggedIn = user; window.qaLoginCount = (window.qaLoginCount || 0) + 1; }} />);
