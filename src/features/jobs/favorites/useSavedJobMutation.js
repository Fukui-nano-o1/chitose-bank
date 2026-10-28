import { useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { setSavedJob } from './savedJobRecord.js';

export function useSavedJobMutation(owner) {
  const locks = useRef(new Set()), currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [busy, setBusy] = useState(new Set());
  const mutate = async (jobNumber, liked, confirmed) => {
    const key = `${owner}:${jobNumber}`;
    if (locks.current.has(key)) return;
    locks.current.add(key); setBusy(new Set(locks.current));
    try {
      const saved = await setSavedJob(supabase, owner, jobNumber, liked);
      if (currentOwner.current === owner) confirmed(saved);
    } catch (error) { if (currentOwner.current === owner) alert(error.message || 'いいねの保存結果を確認できません。'); }
    finally { locks.current.delete(key); setBusy(new Set(locks.current)); }
  };
  return { mutate, isBusy: jobNumber => busy.has(`${owner}:${jobNumber}`) };
}
