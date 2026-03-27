import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

// 認証確認用: 公開キー側
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 管理用: DB書き込み専用
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function getClientIp(request) {
  const raw = request.headers.get('x-forwarded-for')
  if (!raw) return null
  return raw.split(',')[0]?.trim() || null
}

async function parseBody(request) {
  try {
    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!email || !token) {
      return { ok: false, error: 'email and token are required' }
    }
    return { ok: true, email, token }
  } catch {
    return { ok: false, error: 'invalid json body' }
  }
}

export async function POST(request) {
  const timestamp = new Date().toISOString()
  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') || null

  const parsed = await parseBody(request)
  if (!parsed.ok) {
    return json({ error: parsed.error, timestamp }, 400)
  }

  const { email, token } = parsed

  try {
    // OTP検証は公開側クライアントで行う
    const { data: authData, error: authError } = await authClient.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })

    if (authError || !authData.user || !authData.session) {
      console.warn('[verify-otp] failed:', authError?.message ?? 'unknown', { email, ip })
      return json({ error: authError?.message ?? 'OTP verification failed', timestamp }, 401)
    }

    const user = authData.user
    const userEmail = user.email ?? email

    // 未登録とDBエラーを区別する
    const { data: existingFarmer, error: farmerReadError } = await admin
      .from('farmers')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (farmerReadError) {
      console.error('[verify-otp] farmers read error:', farmerReadError.message)
      return json({ error: 'Failed to read farmer profile', timestamp }, 500)
    }

    const isSignup = !existingFarmer

    // race condition 対策で upsert
    const { error: upsertError } = await admin
      .from('farmers')
      .upsert(
        { id: user.id, email: userEmail, name: userEmail.split('@')[0] || 'farmer' },
        { onConflict: 'id' }
      )

    if (upsertError) {
      console.error('[verify-otp] farmers upsert error:', upsertError.message)
      return json({ error: 'Failed to sync farmer profile', timestamp }, 500)
    }

    // ログ失敗でもログイン自体は潰さない
    const { error: logError } = await admin.from('auth_logs').insert({
      farmer_id: user.id,
      action: isSignup ? 'signup' : 'login',
      ip_address: ip,
      user_agent: userAgent,
    })

    if (logError) {
      console.error('[verify-otp] auth_logs error:', logError.message)
    }

    return json({
      status: 'ok',
      user: { id: user.id, email: userEmail },
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
        expires_in: authData.session.expires_in,
        token_type: authData.session.token_type,
      },
      timestamp,
    }, 200)

  } catch (err) {
    console.error('[verify-otp] unexpected error:', err?.message ?? err)
    return json({ error: 'Internal server error', timestamp }, 500)
  }
}
