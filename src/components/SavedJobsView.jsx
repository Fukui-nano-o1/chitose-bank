// いいね一覧（#/saved・分割・段階2後半・2026-07-24）：saved_jobs(本人のみ)とjobs_publicをjoinして表示。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow } from "../lib/utils";
import { JobCard } from "./JobCard";

// ── SavedJobsView（いいね一覧・#/saved）：saved_jobs(本人のみ)とjobs_publicをjoinして表示 ──
export function SavedJobsView({ me }) {
  const [jobs, setJobs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: saved } = await supabase.from("saved_jobs").select("job_number").eq("worker_id", me.id);
        const nums = (saved || []).map(r => r.job_number);
        if (!nums.length) { if (!cancelled) setJobs([]); return; }
        const { data } = await supabase.from("jobs_public").select("*").in("job_number", nums).order("job_number",{ascending:false});
        if (!cancelled) setJobs((data || []).map(mapJobPublicRow));
      } catch { if (!cancelled) setJobs([]); }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  const handleUnsave = async (job) => {
    setJobs(prev => (prev || []).filter(j => j.id !== job.id));
    await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", job.id);
  };

  if (jobs === null) return null;

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:6 }}>いいねした求人</h2>
      </div>
      {jobs.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:40, marginBottom:16 }}>♡</div>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7 }}>気になる求人を💚しておくと、ここに並びます</p>
        </div>
      ) : (
        <div>
          {jobs.map(job => (
            <JobCard key={job.id} job={job} variant="list" saved={true} onToggleSave={handleUnsave} />
          ))}
        </div>
      )}
    </div>
  );
}
