import { createClient } from '@supabase/supabase-js'

const HEALTH_TIMEOUT_MS = 3000
let admin = null

function getAdminClient() {
  if (admin) return admin
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return admin
}

async function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' })
  }

  const timestamp = new Date().toISOString()

  try {
    const client = getAdminClient()
    await withTimeout(
      client.from('farmers').select('id', { head: true }).limit(1)
        .then(({ error }) => { if (error) throw error }),
      HEALTH_TIMEOUT_MS
    )

    if (req.method === 'HEAD') return res.status(200).end()

    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      service: 'chitose-bank-core',
      timestamp,
    })
  } catch (err) {
    console.error('[health-check] failed:', err?.message ?? err)

    if (req.method === 'HEAD') return res.status(503).end()

    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
      timestamp,
    })
  }
}
