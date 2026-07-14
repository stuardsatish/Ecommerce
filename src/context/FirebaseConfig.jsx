// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDOVf3kS_Ma1A7D2DR6yXWV8xiJRWqFPbQ",
  authDomain: "my-sweet-bec4a.firebaseapp.com",
  projectId: "my-sweet-bec4a",
  storageBucket: "my-sweet-bec4a.firebasestorage.app",
  messagingSenderId: "16541928627",
  appId: "1:16541928627:web:33b73a7474a5fb0d58b4c6",
  measurementId: "G-N64ZEGD27M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const fireDB = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Initialize analytics safely
let analytics;

isSupported().then((yes) => {
  if (yes) {
    analytics = getAnalytics(app);
  }
});

export { fireDB, auth, storage };