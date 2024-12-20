import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';

export default defineConfig({
  vite: {
    define: {
      'process.env.PUBLIC_SPOTIFY_CLIENT_ID': JSON.stringify(process.env.PUBLIC_SPOTIFY_CLIENT_ID),
      'process.env.PUBLIC_FIREBASE_API_KEY': JSON.stringify(process.env.PUBLIC_FIREBASE_API_KEY),
      'process.env.PUBLIC_FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.PUBLIC_FIREBASE_AUTH_DOMAIN),
      'process.env.PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify(process.env.PUBLIC_FIREBASE_PROJECT_ID),
      'process.env.PUBLIC_FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.PUBLIC_FIREBASE_STORAGE_BUCKET),
      'process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
      'process.env.PUBLIC_FIREBASE_APP_ID': JSON.stringify(process.env.PUBLIC_FIREBASE_APP_ID),
      'process.env.PUBLIC_FIREBASE_MEASUREMENT_ID': JSON.stringify(process.env.PUBLIC_FIREBASE_MEASUREMENT_ID),
    },
  },

  integrations: [preact()],
});