import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const apiKey =
  (typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_FIREBASE_API_KEY || import.meta.env.FIREBASE_API_KEY
    : undefined) ||
  (typeof process !== "undefined"
    ? process.env?.FIREBASE_API_KEY || process.env?.VITE_FIREBASE_API_KEY
    : undefined) ||
  "";

/** Email confirmation only. Staff records stay in Postgres. Analytics is not started. */
const firebaseConfig = {
  apiKey,
  authDomain: "kijabeoutflow.firebaseapp.com",
  projectId: "kijabeoutflow",
  storageBucket: "kijabeoutflow.firebasestorage.app",
  messagingSenderId: "951373267596",
  appId: "1:951373267596:web:d76beb81e2092ed6c8f1a9",
  measurementId: "G-4L8NE5R3KZ",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseApiKey = firebaseConfig.apiKey;
