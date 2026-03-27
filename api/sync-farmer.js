import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function getClientIp(req) {
  const raw = req.headers['x-forwarded-for']
  if (!raw) return null
  return raw.split(',')[0]?.trim() || null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const { email, name } = req.body || {}

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }

  const timestamp = new Date().toISOString()
  const ip = getClientIp(req)
  const userAgent = req.headers['user-agent'] || null

  try {
    // 既存ユーザーを確認
    const { data: existing, error: readError } = await admin
      .from('farmers')
      .select('id, email')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    if (readError) {
      console.error('[sync-farmer] read error:', readError.message)
      return res.status(500).json({ error: 'Database read error', timestamp })
    }

    const isSignup = !existing

    // upsert で farmers に同期
    const { error: upsertError } = await admin
      .from('farmers')
      .upsert(
        {
          email: email.trim().toLowerCase(),
          name: name || email.split('@')[0] || 'farmer',
        },
        { onConflict: 'email' }
      )

    if (upsertError) {
      console.error('[sync-farmer] upsert error:', upsertError.message)
      return res.status(500).json({ error: 'Database sync error', timestamp })
    }

    // ログを記録（失敗してもレスポンスは200で返す）
    if (existing?.id) {
      const { error: logError } = await admin.from('auth_logs').insert({
        farmer_id: existing.id,
        action: isSignup ? 'signup' : 'login',
        ip_address: ip,
        user_agent: userAgent,
      })
      if (logError) {
        console.error('[sync-farmer] log error:', logError.message)
      }
    }

    return res.status(200).json({
      status: 'ok',
      action: isSignup ? 'signup' : 'login',
      timestamp,
    })

  } catch (err) {
    console.error('[sync-farmer] unexpected error:', err?.message ?? err)
    return res.status(500).json({ error: 'Internal server error', timestamp })
  }
}
