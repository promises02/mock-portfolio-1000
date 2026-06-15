import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/firebase';
import { buildCatalogPriceMap, computeAssetPnL } from '../src/utils/portfolioPnL';
import { AssetItem } from '../src/types';

async function main() {
  const catalog = buildCatalogPriceMap([], 1500);
  const snap = await getDoc(doc(db, 'portfolios', '김민정'));
  if (!snap.exists()) {
    console.log('no portfolio');
    return;
  }
  const assets = (snap.data().assets ?? []) as AssetItem[];
  const usNames = new Set([
    '알파벗 Class A',
    'TSMC',
    '시놉시스',
    '테슬라',
    'SCHD',
    '록히드마틴',
    '엔비디아',
    '애플',
    '마이크로소프트',
  ]);

  for (const asset of assets) {
    if (!usNames.has(asset.name)) continue;
    const pnl = computeAssetPnL(asset, {}, 1500, catalog);
    console.log(JSON.stringify({
      name: asset.name,
      price: asset.price,
      currentPrice: asset.currentPrice,
      purchasePriceUSD: asset.purchasePriceUSD,
      priceUSD: asset.priceUSD,
      catalogKrw: catalog[asset.name]?.priceKrw,
      purchaseUnitKrw: pnl.purchaseUnitKrw,
      currentUnitKrw: pnl.currentUnitKrw,
      profit: pnl.profitAmount,
      profitRate: pnl.profitRate.toFixed(2),
    }));
  }
}

main().catch(console.error);
