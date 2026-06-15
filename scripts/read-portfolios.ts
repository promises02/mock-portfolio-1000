import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/firebase';

async function main() {
  for (const nickname of process.argv.slice(2)) {
    const snap = await getDoc(doc(db, 'portfolios', nickname));
    if (!snap.exists()) {
      console.log(`${nickname}: NOT FOUND`);
      continue;
    }
    const d = snap.data();
    console.log(`\n=== ${nickname} ===`);
    console.log('savings:', d.savings);
    for (const a of d.assets ?? []) {
      console.log(
        ` - ${a.name} x${a.quantity} price:${a.price} priceUSD:${a.purchasePriceUSD ?? a.priceUSD} current:${a.currentPrice}`
      );
    }
  }
}

main().catch(console.error);
