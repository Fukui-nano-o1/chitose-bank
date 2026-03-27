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
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return admin
}

async function withTimeout(promise, ms) {
  let timer

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Health check timeout after ${ms}ms`))
    }, ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDatabaseConnection() {
  const client = getAdminClient()

  await withTimeout(
    client
      .from('farmers')
      .select('id', { head: true })
      .limit(1)
      .then(({ error }) => {
        if (error) throw error
      }),
    HEALTH_TIMEOUT_MS
  )
}

export default async function handler(req, res) {
  const timestamp = new Date().toISOString()

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Allow', 'GET, HEAD')

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({
      status: 'error',
      message: 'Method Not Allowed',
      timestamp,
    })
  }

  try {
    await checkDatabaseConnection()

    if (req.method === 'HEAD') return res.status(200).end()

    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      service: 'chitose-bank-core',
      timestamp,
    })
  } catch (err) {
    console.error('[health-check] failed:', err instanceof Error ? err.message : err)

    if (req.method === 'HEAD') return res.status(503).end()

    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
      timestamp,
      message: err instanceof Error ? err.message : 'Database health check failed',
    })
  }
}
