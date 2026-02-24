import express from "express";
import axios from "axios";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync } from "fs";
import "dotenv/config";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3001/auth/callback";
const TOKEN_FILE = "./tokens.json";

// Persist tokens across server restarts
let tokens = null;
if (existsSync(TOKEN_FILE)) {
  try {
    tokens = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    console.log("✓ Loaded saved Strava tokens");
  } catch {
    console.log("Could not read tokens.json");
  }
}

function saveTokens(t) {
  tokens = t;
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
}

// ── OAuth ──────────────────────────────────────────────────────────────────

app.get("/auth/strava", (_req, res) => {
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "activity:read_all");
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect("http://localhost:5173?error=auth_denied");
  }
  try {
    const { data } = await axios.post("https://www.strava.com/oauth/token", {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    });
    saveTokens(data);
    res.redirect("http://localhost:5173?connected=true");
  } catch (e) {
    console.error("Token exchange failed:", e.message);
    res.redirect("http://localhost:5173?error=token_failed");
  }
});

// ── Token refresh ──────────────────────────────────────────────────────────

async function getValidToken() {
  if (!tokens) return null;
  // Refresh if expiring within 5 minutes
  if (Date.now() / 1000 > tokens.expires_at - 300) {
    try {
      const { data } = await axios.post("https://www.strava.com/oauth/token", {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      });
      saveTokens({ ...tokens, ...data });
    } catch (e) {
      console.error("Token refresh failed:", e.message);
      return null;
    }
  }
  return tokens.access_token;
}

// ── API routes ─────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => {
  res.json({ connected: tokens !== null });
});

app.get("/api/athlete", async (_req, res) => {
  const token = await getValidToken();
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const { data } = await axios.get("https://www.strava.com/api/v3/athlete", {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/activities", async (_req, res) => {
  const token = await getValidToken();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const all = [];
    let page = 1;
    while (true) {
      const { data } = await axios.get(
        "https://www.strava.com/api/v3/athlete/activities",
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { per_page: 200, page },
        }
      );
      if (!data.length) break;
      all.push(...data);
      if (data.length < 200) break;
      page++;
    }

    const runs = all
      .filter((a) => a.type === "Run" || a.sport_type === "Run")
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: a.start_date_local.slice(0, 10), // "YYYY-MM-DD"
        distance_miles: Math.round((a.distance / 1609.34) * 100) / 100,
        moving_time: a.moving_time,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(runs);
  } catch (e) {
    console.error("Activities fetch failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () =>
  console.log("Server running → http://localhost:3001")
);
