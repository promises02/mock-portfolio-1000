/** Firebase Admin SDK — Vercel serverless 등에서 Firestore 규칙 우회 쓰기 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let adminApp: App | undefined;
let adminDb: Firestore | null | undefined;

export function getAdminFirestoreDb(): Firestore | null {
  if (adminDb !== undefined) return adminDb;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) {
    adminDb = null;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw) as Record<string, unknown>;
    adminApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: cert(serviceAccount as Parameters<typeof cert>[0]),
            projectId: firebaseConfig.projectId,
          });
    adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
    return adminDb;
  } catch (error) {
    console.error('[firebaseAdmin] init failed:', error);
    adminDb = null;
    return null;
  }
}
