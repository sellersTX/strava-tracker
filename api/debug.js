import axios from "axios";

async function getFreshAccessToken() {
  const { data } = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

export default async function handler(req, res) {
  const token = await getFreshAccessToken();
  const { data } = await axios.get(
    "https://www.strava.com/api/v3/athlete/activities",
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { per_page: 3, page: 1 },
    }
  );
  // Return only the location-related fields from the first 3 activities
  res.json(
    data.map((a) => ({
      name: a.name,
      date: a.start_date_local?.slice(0, 10),
      location_city: a.location_city,
      location_state: a.location_state,
      location_country: a.location_country,
      start_latlng: a.start_latlng,
    }))
  );
}
