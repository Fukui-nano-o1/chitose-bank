// チャットのプッシュ通知送信（2026-07-19）。DBトリガー(pg_net)から {recipient_id} を受け、
// 受信者の全端末へ「新しいメッセージが届きました」を送る。verify_jwt=false・push_config.trigger_secretで認証。
// デプロイ: Supabaseダッシュボード or `supabase functions deploy send-push --no-verify-jwt`
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

    webpush.setVapidDetails(cfg.subject, cfg.vapid_public, cfg.vapid_private);

    const { data: subs } = await supabase
      .from('push_subscriptions').select('*').eq('auth_id', recipientId);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    // アプリアイコンのバッジ数＝受信者の未読数（内容は運ばず数値のみ）
    let badge = 0;
    try { const { data: cnt } = await supabase.rpc('unread_count_for', { p_uid: recipientId }); if (typeof cnt === 'number') badge = cnt; } catch (_) { badge = 0; }

    const payload = JSON.stringify({ title: 'chitose-bank', body: '新しいメッセージが届きました', badge });
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
