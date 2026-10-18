// Current clients verify OTP with Supabase Auth directly (LoginScreen).
// This retired route must never recreate a service-role profile write.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'HEAD') return res.status(410).end()
  return res.status(410).json({
    error: 'This endpoint is no longer available.',
    code: 'LEGACY_ENDPOINT_RETIRED',
  })
}
