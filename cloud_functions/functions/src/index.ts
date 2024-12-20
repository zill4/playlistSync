/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import {onRequest} from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as jwt from 'jsonwebtoken';

admin.initializeApp();

export const getSpotifyToken = functions.https.onCall(async (data, context) => {
  try {
    // Get secret from Firebase environment config
    const spotifySecret = functions.config().spotify.client_secret;
    const spotifyClientId = functions.config().spotify.client_id;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', spotifyClientId);
    params.append('client_secret', spotifySecret);

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params
    });

    if (!response.ok) {
      throw new Error('Failed to get Spotify token');
    }

    const data = await response.json();
    return {
      access_token: data.access_token,
      expires_in: data.expires_in
    };
  } catch (error) {
    console.error('Error getting Spotify token:', error);
    throw new functions.https.HttpsError('internal', 'Failed to get Spotify token');
  }
});

export const getMusicKitToken = functions.https.onCall(async (data, context) => {
  try {
    // Initialize Secret Manager client
    const secretManager = new SecretManagerServiceClient();
    
    // Get the private key from Secret Manager
    const [version] = await secretManager.accessSecretVersion({
      name: 'projects/772100231536/secrets/APPLE_MUSIC_PRIVATE_KEY/versions/latest'
    });

    // Get the private key and ensure it's properly formatted
    let privateKey = version.payload?.data?.toString() || '';
    
    // If the key doesn't include the PEM headers, add them
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }
    
    // Get other required values from Firebase config
    const config = functions.config().musickit;
    
    const payload = {
      iss: config.team_id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      keyid: config.key_id,
      header: {
        alg: 'ES256',
        kid: config.key_id
      }
    });

    return { token };
  } catch (error) {
    console.error('Error generating MusicKit token:', error);
    throw new functions.https.HttpsError('internal', 'Failed to generate MusicKit token');
  }
});

export const exchangeSpotifyCode = functions.https.onCall(async (data, context) => {
  try {
    const { code, redirectUri } = data;
    
    // Get secrets from Firebase environment config
    const spotifySecret = functions.config().spotify.client_secret;
    const spotifyClientId = functions.config().spotify.client_id;
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: spotifyClientId,
      client_secret: spotifySecret
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      console.error('Spotify token exchange failed:', await response.text());
      throw new functions.https.HttpsError('internal', 'Failed to exchange code');
    }

    const tokenData = await response.json();
    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in
    };
  } catch (error) {
    console.error('Error exchanging Spotify code:', error);
    throw new functions.https.HttpsError('internal', 'Failed to exchange Spotify code');
  }
});