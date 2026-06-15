import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db, getAllCommunityCustomAssets, normalizeCustomAsset } from '../src/firebase';
import { buildCatalogPriceMap, computeAssetPnL } from '../src/utils/portfolioPnL';
import { AssetItem } from '../src/types';

const US_TICKERS = [
  '알파벳 Class A',
  'TSMC',
  '시놉시스',
  '테슬라',
  'SCHD',
  '록히드마틴',
  '엔비디아',
  '애플',
  '마이크로소프트',
];

async function loadMarketPrices() {
  const map: Record<string, number> = {};
  const snap = await getDocs(collection(db, 'customPrices'));
  snap.forEach((d) => {
    const data = d.data();
    const isAdmin = data.lastUpdatedBy === 'admin' || data.source === 'admin_override';
    if (isAdmin && typeof data.price === 'number') map[d.id] = data.price;
  });
  return map;
}

async function main() {
  const customAssets = await getAllCommunityCustomAssets();
  const marketPrices = await loadMarketPrices();
  const catalogEmpty = buildCatalogPriceMap([], 1500);
  const catalogApp = buildCatalogPriceMap(customAssets, 1500);

  console.log('customAssets count:', customAssets.length);
  for (const c of customAssets) {
    if (!US_TICKERS.some((n) => c.name.includes(n.replace(' Class A', '')) || c.name === n)) continue;
    console.log(' custom:', c.name, 'priceUSD', c.priceUSD, 'price', c.price, 'addedBy', c.addedBy, 'lastUpdatedBy', c.lastUpdatedBy);
  }

  const users = ['한영준', '김민정', '이준성', '이현우'];
  for (const user of users) {
    const snap = await getDoc(doc(db, 'portfolios', user));
    if (!snap.exists()) continue;
    const assets = (snap.data().assets ?? []) as AssetItem[];
    console.log(`\n=== ${user} ===`);
    for (const asset of assets) {
      if (!US_TICKERS.includes(asset.name)) continue;
      const empty = computeAssetPnL(asset, marketPrices, 1500, catalogEmpty);
      const app = computeAssetPnL(asset, marketPrices, 1500, catalogApp);
      console.log(
        asset.name,
        `purchase=${asset.price}`,
        `emptyCat ${empty.profitRate.toFixed(2)}%`,
        `appCat ${app.profitRate.toFixed(2)}%`,
        empty.profitRate === app.profitRate ? '' : '<< DIFF'
      );
    }
  }
}

main().catch(console.error);
