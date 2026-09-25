import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_GBP_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_GBP_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_GBP_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error(
        'Google GBP OAuth environment variables are missing'
    );
}

// Create OAuth2 client
export const oAuth2ClientGBP = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

export async function refreshAccessToken(refreshToken: string) {
    try {
        oAuth2ClientGBP.setCredentials({
            refresh_token: refreshToken,
        });

        const { token } = await oAuth2ClientGBP.getAccessToken();

        return token;
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw error;
    }
}