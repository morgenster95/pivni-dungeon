// Inicializace Firebase. Konfigurace webové aplikace je veřejná; data chrání pravidla Firestore.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCrtK_99uh1SGyj2KhA2ljH3aAhynDnhqI",
    authDomain: "pivnidungeon.firebaseapp.com",
    projectId: "pivnidungeon",
    storageBucket: "pivnidungeon.firebasestorage.app",
    messagingSenderId: "174543526039",
    appId: "1:174543526039:web:be6092c458e376c306b1d2"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
