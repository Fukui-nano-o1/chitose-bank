import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useReviewWindow(applicationId) {
  const [windowInfo, setWindowInfo] = useState({state:'loading'});
  const request = useRef(0);
  const expires = useRef(0);
  const controller = useRef(null);
  const refresh = useCallback(async () => {
    if (!applicationId) return;
    const seq = ++request.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const started = performance.now();
    const timeout = setTimeout(() => abort.abort(), 15000);
    setWindowInfo(prev => ({...prev,state:'loading'}));
    try {
      const {data,error} = await supabase.rpc('review_window',{p_application_id:applicationId}).abortSignal(abort.signal);
      if (seq !== request.current) return;
      if (error || !data?.ok || !['open','closed','not_started','unavailable'].includes(data.state)) {
        setWindowInfo({state:'error'}); return;
      }
      expires.current = started + (Date.parse(data.closes_at)-Date.parse(data.server_now));
      setWindowInfo({...data,state:data.state==='open' && performance.now() >= expires.current ? 'closed' : data.state});
    } catch {
      if (seq === request.current) setWindowInfo({state:'error'});
    } finally { clearTimeout(timeout); }
  },[applicationId]);

  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange',visible);
    return () => { ++request.current; controller.current?.abort(); document.removeEventListener('visibilitychange',visible); };
  },[refresh]);
  useEffect(() => {
    if (windowInfo.state !== 'open') return;
    const timer=setTimeout(() => setWindowInfo(prev => ({...prev,state:'closed'})),Math.max(0,expires.current-performance.now()));
    return () => clearTimeout(timer);
  },[windowInfo]);

  function canSubmit() {
    if (windowInfo.state !== 'open') return false;
    if (performance.now() < expires.current) return true;
    setWindowInfo(prev => ({...prev,state:'closed'})); return false;
  }
  function reject(reason) {
    const state=['closed','not_started','unavailable'].find(value=>String(reason).includes('review_window_'+value));
    if (!state) return false;
    setWindowInfo(prev=>({...prev,state})); return true;
  }
  return {...windowInfo,refresh,canSubmit,reject};
}
