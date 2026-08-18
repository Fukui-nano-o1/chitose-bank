// チャットのプッシュ通知送信（2026-07-19／2026-08-18 内容つきに変更）。
// DBトリガー(pg_net)から {recipient_id, kind, id} を受け、受信者の全端末へ通知を送る。
// verify_jwt=false・push_config.trigger_secretで認証。
// デプロイ: Supabaseダッシュボード or `supabase functions deploy send-push --no-verify-jwt`
//
// ★表示する文言（題名＝送信者の表示名／本文＝冒頭40字／遷移先／まとめ方）は
//   DBの push_payload(kind, id) が唯一のソース。ここでは組み立てない（SWにも散らさない）。
// ★本文はトリガーからは渡ってこない：pg_netは送信bodyをキュー表に残すため、
//   会話の中身はここでservice_roleとして引く。
// ★古い形（{recipient_id}だけ）のリクエストも受ける＝入れ替えの前後で通知が落ちない。
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get('x-trigger-secret') || '';
    const { data: cfg } = await supabase.from('push_config').select('*').eq('id', 1).maybeSingle();
    if (!cfg || secret !== cfg.trigger_secret) {
      return new Response('unauthorized', { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const recipientId = body.recipient_id;
    if (!recipientId) return new Response('no recipient', { status: 400 });

    // 表示内容はDBの1関数から受け取る。引けなければ従来の固定文に落ちる（通知そのものは落とさない）
    let title = 'chitose-bank';
    let text = '新しいメッセージが届きました';
    let url = '/#/chats';
    let tag = 'cb-chat';
    if (body.kind && body.id) {
      try {
        const { data: p } = await supabase.rpc('push_payload', { p_kind: body.kind, p_id: body.id });
        if (p && p.title) { title = p.title; text = p.body || text; url = p.url || url; tag = p.tag || tag; }
      } catch (_) { /* 固定文のまま送る */ }
    }

    webpush.setVapidDetails(cfg.subject, cfg.vapid_public, cfg.vapid_private);

    const { data: subs } = await supabase
      .from('push_subscriptions').select('*').eq('auth_id', recipientId);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    // アプリアイコンのバッジ数＝受信者の未読数（内容は運ばず数値のみ）
    let badge = 0;
    try { const { data: cnt } = await supabase.rpc('unread_count_for', { p_uid: recipientId }); if (typeof cnt === 'number') badge = cnt; } catch (_) { badge = 0; }

    const payload = JSON.stringify({ title, body: text, url, tag, badge });
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err && (err.statusCode || err.status)) as number | undefined;
        // 期限切れ/無効な購読は掃除（410 Gone / 404）
        if (code === 410 || code === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
