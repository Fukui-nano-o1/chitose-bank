import { useEffect, useState } from 'react';
import { readAdminMembership } from '../lib/authorization';

export function useAdminMembership(client, subject) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let alive = true, generation = 0;
    const refresh = async () => {
      const request = ++generation;
      const admin = await readAdminMembership(client, subject);
      if (alive && request === generation) setResult({ subject, admin });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [client, subject]);
  return !!subject && result?.subject === subject && result.admin === true;
}
