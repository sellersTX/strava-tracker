export default function handler(req, res) {
  const connected = /strava_token=/.test(req.headers.cookie || "");
  res.json({ connected });
}
