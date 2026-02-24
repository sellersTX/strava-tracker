// TEMPORARY — delete this file after copying your refresh token
export default function handler(req, res) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/strava_token=([^;]+)/);
  if (!match) return res.status(401).json({ error: "No token cookie found. Log in first." });
  try {
    const tokens = JSON.parse(Buffer.from(match[1], "base64").toString("utf-8"));
    res.json({ refresh_token: tokens.refresh_token });
  } catch {
    res.status(500).json({ error: "Could not parse token cookie." });
  }
}
