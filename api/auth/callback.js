import axios from "axios";

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function setTokenCookie(res, tokens, secure) {
  const encoded = Buffer.from(JSON.stringify(tokens)).toString("base64");
  const year = 60 * 60 * 24 * 365;
  res.setHeader(
    "Set-Cookie",
    `strava_token=${encoded}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${year}`
  );
}

export default async function handler(req, res) {
  const { code, error } = req.query;
  const baseUrl = getBaseUrl(req);
  const isSecure = req.headers["x-forwarded-proto"] === "https";

  if (error || !code) {
    return res.redirect(`${baseUrl}?error=auth_denied`);
  }

  try {
    const { data } = await axios.post("https://www.strava.com/oauth/token", {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    });

    setTokenCookie(res, data, isSecure);
    res.redirect(`${baseUrl}?connected=true`);
  } catch (e) {
    console.error("Token exchange failed:", e.message);
    res.redirect(`${baseUrl}?error=token_failed`);
  }
}
