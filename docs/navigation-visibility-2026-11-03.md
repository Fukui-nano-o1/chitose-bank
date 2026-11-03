# Mobile navigation after login

## Scope and reproduced failure

The mobile navigation can remain hidden after a focused login input is removed.
The previous App effect added `body.cb-typing` on focus but cleared it only after
`focusout`. Removing the focused node does not necessarily send that event.
The login-page CSS exception temporarily masks the stale class, so the bar can
vanish when the login screen is replaced. A fresh page load has no stale class.

An isolated JSDOM fixture using the real LoginScreen and MobileNavigation reproduced
this on password submission with focus still in the password field and on delayed
session hydration. The old effect failed both assertions; the corrected effect passes.
This is a demonstrated lifecycle defect, not proof that it is the only cause of a
particular production report or a role-specific permissions problem. Cached-session
entry and interactive login follow different paths.

## Change

`app/navigation/typingVisibility.js` owns the existing keyboard-visibility effect.
While a text field has focus, it observes DOM removals. If that field becomes
detached, it synchronizes the class with the actual active element. It also
synchronizes initial focus and normal focus changes, retaining the delayed blur
check for field switching. The observer is disconnected outside text input and
all listeners, timers, and classes are cleaned up on unmount.

No authentication, account registration, authorization, navigation destinations,
scroll-collapse behavior, CSS layout, database, or service-worker behavior changes.
Account forms and full-screen overlays retain their existing navigation gates.

## Verification and limits

The new test is part of `test:critical`, alongside the existing navigation component
suite. Synthetic coverage includes worker/farmer login, delayed authentication,
restored session, failed login, field switching, replacement focus, ancestor removal,
repeated login, Back/Forward, cleanup, and existing role/capability destinations and
repeat-tab reload requests. Static checks retain the mobile breakpoint and safe-area
layout rules. These tests do not claim pixel layout, real reload, or physical-device
coverage. Actual Chromium/mobile-browser verification was not run in this environment.

Before release, verify a normal account on mobile: enter from login with the software
keyboard open, submit, confirm Search and Calendar without reload, navigate Back and
Forward, reopen/close an input, and compare restored-session and administrator entry.
Check both worker-only and employer-capable calendar destinations at narrow widths.

This is a local code change. Publication and production verification are separate
steps. No migration or settings change is needed. Roll back by reverting the single
navigation fix commit; no user data is changed.
