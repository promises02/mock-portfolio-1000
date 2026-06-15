import { doc, setDoc } from 'firebase/firestore';
import { db } from '../src/firebase';

const fixes = [
  { nickname: '한영준', savings: 318_040, buyTotal: 9_681_960 },
  { nickname: '김민정', savings: 463_800, buyTotal: 9_536_200 },
  { nickname: '이준성', savings: 277_310, buyTotal: 9_722_690 },
  { nickname: '이현우', savings: 584_260, buyTotal: 9_415_740 },
];

async function main() {
  for (const { nickname, savings, buyTotal } of fixes) {
    const totalCurrentValue = buyTotal;
    const totalAssets = savings + buyTotal;
    await setDoc(
      doc(db, 'portfolios', nickname),
      {
        savings,
        totalCurrentValue,
        totalAssets,
        totalPurchaseAmount: buyTotal,
        profitAmount: 0,
        profitRate: 0,
        totalProfitAmount: 0,
        totalProfitRate: 0,
        updatedAt: new Date('2026-05-29T00:00:00+09:00'),
      },
      { merge: true }
    );
    console.log(`${nickname}: totalAssets=${totalAssets.toLocaleString()}원 ✓`);
  }
}

main().catch(console.error);
