export default function handler(req, res) {
  res.json({ connected: !!process.env.STRAVA_REFRESH_TOKEN });
}
