import { OAuth2Client } from "google-auth-library";
import { tokenTypes } from "./constantTypes";

const ANALYTICS_CLIENT_ID = process.env.GOOGLE_ANALYTICS_CLIENT_ID;
const ANALYTICS_CLIENT_SECRET = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
const ANALYTICS_REDIRECT_URI = process.env.GOOGLE_ANALYTICS_REDIRECT_URI;

const GBP_CLIENT_ID = process.env.GOOGLE_GBP_CLIENT_ID;
const GBP_CLIENT_SECRET = process.env.GOOGLE_GBP_CLIENT_SECRET;
const GBP_REDIRECT_URI = process.env.GOOGLE_GBP_REDIRECT_URI;

if (
  !ANALYTICS_CLIENT_ID ||
  !ANALYTICS_CLIENT_SECRET ||
  !ANALYTICS_REDIRECT_URI
) {
  throw new Error("Google Analytics OAuth environment variables are missing");
}

if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET || !GBP_REDIRECT_URI) {
  throw new Error("Google GBP OAuth environment variables are missing");
}

export let oAuth2Client = (type: string) => {
  let client_id = "";
  let client_secret = "";
  let callbackUrl = "";

  if (type === tokenTypes.ANALYTICS) {
    client_id = ANALYTICS_CLIENT_ID;
    client_secret = ANALYTICS_CLIENT_SECRET;
    callbackUrl = ANALYTICS_REDIRECT_URI;
  } else if (type === tokenTypes.GBP) {
    client_id = GBP_CLIENT_ID;
    client_secret = GBP_CLIENT_SECRET;
    callbackUrl = GBP_REDIRECT_URI;
  }

  const instance = new OAuth2Client({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUri: callbackUrl,
  });

  return instance;
};