import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/firebase';

async function main() {
  for (const nickname of ['한영준', '김민정', '이준성', '이현우']) {
    const snap = await getDoc(doc(db, 'portfolios', nickname));
    if (!snap.exists()) {
      console.log(`${nickname}: NOT FOUND`);
      continue;
    }
    const data = snap.data();
    console.log(`\n=== ${nickname} ===`);
    console.log('savings:', data.savings);
    console.log('initialCapital:', data.initialCapital);
    console.log('exchangeRate:', data.exchangeRate);
    console.log('totalAssets:', data.totalAssets);
    console.log('assets:', (data.assets ?? []).map((a: { name: string; quantity: number; price: number }) => `${a.name} x${a.quantity} @${a.price}`).join(' | '));
    console.log('reason:', data.reason);
  }
}

main().catch(console.error);
