import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/** Email confirmation only. Staff records stay in Postgres. Analytics is not started. */
const firebaseConfig = {
  apiKey: "AIzaSyAMRu6hwOq0Djh3qj6yI43NunsPXRYKnJw",
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
