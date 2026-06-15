import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/firebase';
import { computeAssetPnL, buildCatalogPriceMap, getCurrentPriceUsd } from '../src/utils/portfolioPnL';

async function main() {
  const rate = 1500;
  const catalog = buildCatalogPriceMap([], rate);
  const nicknames = ['한영준', '김민정', '이준성', '이현우'];

  for (const nickname of nicknames) {
    const snap = await getDoc(doc(db, 'portfolios', nickname));
    if (!snap.exists()) continue;
    const assets = (snap.data().assets ?? []) as import('../src/types').AssetItem[];
    console.log(`\n=== ${nickname} ===`);
    for (const asset of assets) {
      const pnl = computeAssetPnL(asset, {}, rate, catalog);
      const currentUsd = getCurrentPriceUsd(asset, {}, rate, catalog);
      console.log(
        [
          asset.name,
          `purchaseUSD=${asset.purchasePriceUSD}`,
          `currentUSD=${currentUsd.toFixed(2)}`,
          `profit=${pnl.profitAmount}`,
          `${pnl.profitRate.toFixed(2)}%`,
        ].join(' | ')
      );
    }
  }
}

main().catch(console.error);
