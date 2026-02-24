export default function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/callback`;

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", process.env.STRAVA_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "activity:read_all");

  res.redirect(url.toString());
}
