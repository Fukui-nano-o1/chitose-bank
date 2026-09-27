-- 2026-09-27: the publish gate already required a non-empty address, but any text passed,
-- so a job went live with the street address "00" (#1313). The worker could only see the town
-- and the Google Maps link landed on the town centre.
-- Reject an address that is made only of zeros / separators / the words for "banchi"/"go".
-- Stripped characters: 0 (fullwidth 0) space (ideographic space) - (fullwidth -) (hyphen)
--   (ban) (chi) (go) (no) (ideographic comma) , .
-- Same character set as isValidStreetAddress in src/features/jobs/create/model.js.
-- Change both or neither.
-- The function body is not retyped: one ASCII anchor is replaced in the live definition.
do $mig$
declare
  src text;
  n int;
  old_cond text := $a$coalesce(btrim(new.address),'') = '' then$a$;
  new_cond text := $b$coalesce(btrim(new.address),'') = ''
       or regexp_replace(btrim(new.address), '[0０\s　ー\-－‐番地号の、,.]', '', 'g') = '' then$b$;
begin
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'trg_job_publish_snapshot' and pronamespace = 'public'::regnamespace;
  if src is null then
    raise exception 'trg_job_publish_snapshot not found';
  end if;
  if position(new_cond in src) > 0 then
    return; -- already applied
  end if;
  n := (length(src) - length(replace(src, old_cond, ''))) / length(old_cond);
  if n <> 1 then
    raise exception 'anchor count is %, expected 1', n;
  end if;
  execute replace(src, old_cond, new_cond);
end
$mig$;
