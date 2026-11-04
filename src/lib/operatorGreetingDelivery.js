// Only explicit successful authentication calls create a login intent. Session
// restoration may retry that intent, but must never invent one from SIGNED_IN.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["delivered", "idle", "disabled", "stale", "registration_pending"]);

export function operatorGreetingIdentity(session) {
  try {
    const part = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claim = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (!UUID.test(session.user.id) || !UUID.test(claim.session_id) || claim.sub !== session.user.id) return null;
    // This decode is only a correlation hint, never authorization. The RPC
    // independently verifies auth.uid(), signed claims, and auth.sessions.
    return { userId: session.user.id, sessionId: claim.session_id };
  } catch { return null; }
}

export function createOperatorGreetingDelivery({
  client, enabled = false, getStorage = () => window.localStorage,
  retryDelays = [1000, 5000, 30000], setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const memory = new Map();
  const pending = new Map();
  const timers = new Map();
  const key = identity => `cb_operator_login_pending_v1:${identity.userId}:${identity.sessionId}`;
  const hasIntent = identity => {
    try { return memory.has(key(identity)) || getStorage().getItem(key(identity)) === "1"; }
    catch { return memory.has(key(identity)); }
  };
  const remember = identity => {
    memory.set(key(identity), true);
    try { getStorage().setItem(key(identity), "1"); } catch { /* storage denial never blocks login */ }
  };
  const forget = identity => {
    memory.delete(key(identity));
    try { getStorage().removeItem(key(identity)); } catch { /* server deduplication remains authoritative */ }
  };
  function deliver(identity, recordLogin, attempt = 0, fresh = false) {
    const flightKey = `${key(identity)}:${recordLogin}`;
    if (pending.has(flightKey)) {
      const previous = pending.get(flightKey);
      // A post-save drain cannot be satisfied by a pre-save registration_pending.
      return fresh ? previous.then(() => deliver(identity, recordLogin)) : previous;
    }
    if (timers.has(flightKey)) { clearTimer(timers.get(flightKey)); timers.delete(flightKey); }
    const flight = Promise.resolve().then(async () => {
      try {
        const { data, error } = await client.rpc("deliver_my_operator_greetings", {
          p_expected_user: identity.userId,
          p_expected_session: identity.sessionId,
          p_record_login: recordLogin,
        });
        if (!error && TERMINAL.has(data?.status)) {
          if (recordLogin) forget(identity);
          return data.status;
        }
      } catch { /* keep the original intent for a later online/reload retry */ }
      if (attempt < retryDelays.length) timers.set(flightKey, setTimer(() => {
        timers.delete(flightKey);
        void deliver(identity, recordLogin, attempt + 1);
      }, retryDelays[attempt]));
      return "retry";
    }).finally(() => pending.delete(flightKey));
    pending.set(flightKey, flight);
    return flight;
  }
  return {
    recordLogin(session) {
      if (!enabled) return Promise.resolve("disabled");
      const identity = operatorGreetingIdentity(session);
      if (!identity) return Promise.resolve("stale");
      remember(identity); // No access/refresh token, email, or message body is persisted.
      return deliver(identity, true);
    },
    async retry(userId, { afterRegistration = false } = {}) {
      if (!enabled || !UUID.test(userId)) return "disabled";
      try {
        const { data, error } = await client.auth.getSession();
        const identity = !error && operatorGreetingIdentity(data?.session);
        if (!identity || identity.userId !== userId) return "stale";
        // A normal restored session only drains existing server events.
        return deliver(identity, hasIntent(identity), 0, afterRegistration);
      } catch { return "retry"; }
    },
  };
}
