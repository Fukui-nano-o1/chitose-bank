import { chatDeadline } from "../../../lib/chatMessaging";

// Preserve PostgreSQL microseconds when two events share a JavaScript millisecond.
const compareTime = (left, right) => Date.parse(left) - Date.parse(right)
  || Number((left.match(/\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(3, 6))
    - Number((right.match(/\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(3, 6));

// Only server-fetched events that have been rendered belong in this acknowledgement.
// Never use the device clock as the last-seen boundary.
export function chatReadSnapshot(owner, applicationId, messages, application) {
  const observed = messages.filter(message => message.application_id === applicationId && !message._pending);
  // Message and application reads are independent snapshots. A later message
  // must not acknowledge a status change absent from the application response.
  const through = application?.status_changed_at && Number.isFinite(Date.parse(application.status_changed_at))
    ? application.status_changed_at : null;
  return { owner, applicationId, through, messageIds: observed.filter(message => message.sender_id !== owner && !message.read_at).map(message => message.id) };
}

export async function acknowledgeChatRead(client, snapshot, isCurrent) {
  const { owner, applicationId, through, messageIds } = snapshot;
  if (!isCurrent()) throw new Error("CHAT_READ_STALE");
  const checkOwner = async () => {
    const result = await chatDeadline(client.auth.getSession());
    if (result.error || result.data?.session?.user?.id !== owner) throw new Error("CHAT_READ_STALE");
  };
  // Once rendered and started, finish this bounded snapshot after navigation.
  // Account changes still stop every subsequent write and result delivery.
  await checkOwner();
  if (messageIds.length) {
    const result = await chatDeadline(client.from("messages").update({ read_at: new Date().toISOString() })
      .eq("application_id", applicationId).in("id", messageIds).neq("sender_id", owner).is("read_at", null));
    if (result.error) throw result.error;
    // UPDATE can return success with zero rows under RLS. Confirm the exact IDs.
    const verified = await chatDeadline(client.from("messages").select("id,read_at").eq("application_id", applicationId).in("id", messageIds));
    if (verified.error || messageIds.some(id => !verified.data?.some(row => row.id === id && row.read_at))) throw new Error("CHAT_READ_UNCONFIRMED");
  }
  if (through) {
    await checkOwner();
    // Ignore an existing row, then advance conditionally. A delayed older request
    // cannot move the marker backwards, including requests from another tab.
    const inserted = await chatDeadline(client.from("chat_reads").upsert(
      { application_id: applicationId, reader_id: owner, last_read_at: through },
      { onConflict: "application_id,reader_id", ignoreDuplicates: true }));
    if (inserted.error) throw inserted.error;
    await checkOwner();
    const advanced = await chatDeadline(client.from("chat_reads").update({ last_read_at: through })
      .eq("application_id", applicationId).eq("reader_id", owner).lt("last_read_at", through));
    if (advanced.error) throw advanced.error;
    const verified = await chatDeadline(client.from("chat_reads").select("last_read_at")
      .eq("application_id", applicationId).eq("reader_id", owner).maybeSingle());
    if (verified.error || !verified.data?.last_read_at || compareTime(verified.data.last_read_at, through) < 0) throw new Error("CHAT_READ_UNCONFIRMED");
  }
  await checkOwner();
}
