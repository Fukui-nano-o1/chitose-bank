// Record IDs, unlike error signatures, survive grouping/classification changes.
export const ERROR_DETAIL_COLUMNS = "id,created_at,source,page,url,component,action,operation,error_code,message,stack,status,user_id,user_agent,identity_verified,admin_note,resolved_at";
export function parseErrorDetailRoute(hash) {
  const path = String(hash || "").replace(/^#\/?/, "");
  if (!path.startsWith("admin/system/errors/")) return null;
  const id = path.slice("admin/system/errors/".length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : "invalid";
}
export async function loadErrorDetail(client, id) {
  if (!id || id === "invalid") return { state: "invalid", row: null };
  // Keep the existing administrator SELECT policy. No elevated RPC or list window.
  try {
    const { data, error } = await client.from("app_errors").select(ERROR_DETAIL_COLUMNS).eq("id", id).maybeSingle();
    if (error) return { state: "error", row: null };
    return { state: data ? "ready" : "missing", row: data || null };
  } catch { return { state: "error", row: null }; }
}
