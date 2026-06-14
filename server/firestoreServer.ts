/** Node 서버용 Firestore 클라이언트 */
import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const serverDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export { collection, doc, getDoc, getDocs, setDoc };
