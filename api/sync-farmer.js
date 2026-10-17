// Retired legacy email-based sync. Do not restore a service-role write here.
// Keep an explicit tombstone so old clients cannot fall through to the SPA.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'HEAD') return res.status(410).end()

  return res.status(410).json({
    error: 'This endpoint is no longer available.',
    code: 'LEGACY_ENDPOINT_RETIRED',
  })
}
