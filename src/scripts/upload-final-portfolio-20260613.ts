// src/scripts/upload-final-portfolio-20260613.ts
// 제미나이가 계산한 6/13 회차 최종 손익을 Firestore에 그대로 저장합니다.
// 앱 계산 로직을 거치지 않고 입력값을 그대로 덮어씁니다.
// 실행: 브라우저 콘솔에서  await window.uploadFinalPortfolio20260613?.()

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface FinalPortfolioEntry {
  nickname: string;
  purchaseAmount: number; // 5/29 매수금액
  evaluation: number;     // 6/13 평가금액
  savings: number;        // 파킹통장
  totalAssets: number;    // 6/13 총자산
  profitAmount: number;   // 손익(원)
  profitRate: number;     // 손익률(%)
}

const SESSION_DATE = '2026-06-13';

const FINAL_DATA: FinalPortfolioEntry[] = [
  { nickname: '이현지', purchaseAmount: 9_984_840, evaluation: 9_722_170, savings: 15_160,    totalAssets: 9_737_330, profitAmount: -262_670, profitRate: -2.63 },
  { nickname: '신윤정', purchaseAmount: 8_119_480, evaluation: 7_635_560, savings: 1_880_520, totalAssets: 9_516_080, profitAmount: -483_920, profitRate: -4.84 },
  { nickname: 'AI',     purchaseAmount: 9_389_070, evaluation: 8_468_135, savings: 610_930,   totalAssets: 9_079_065, profitAmount: -920_935, profitRate: -9.21 },
  { nickname: '강은지', purchaseAmount: 7_060_765, evaluation: 6_528_500, savings: 2_939_235, totalAssets: 9_467_735, profitAmount: -532_265, profitRate: -5.32 },
  { nickname: '한영준', purchaseAmount: 9_681_960, evaluation: 9_421_590, savings: 318_040,   totalAssets: 9_739_630, profitAmount: -260_370, profitRate: -2.60 },
  { nickname: '김민정', purchaseAmount: 9_536_200, evaluation: 8_972_745, savings: 463_800,   totalAssets: 9_436_545, profitAmount: -563_455, profitRate: -5.63 },
  { nickname: '이준성', purchaseAmount: 9_722_690, evaluation: 9_522_935, savings: 277_310,   totalAssets: 9_800_245, profitAmount: -199_755, profitRate: -2.00 },
  { nickname: '이현우', purchaseAmount: 9_415_740, evaluation: 9_409_200, savings: 584_260,   totalAssets: 9_993_460, profitAmount: -6_540,   profitRate: -0.07 },
];

export async function uploadFinalPortfolio20260613(): Promise<void> {
  console.log(`\n📤 ${SESSION_DATE} 최종 손익 업로드 시작 (제미나이 계산값)`);
  let ok = 0;
  for (const p of FINAL_DATA) {
    try {
      await setDoc(
        doc(db, 'portfolios', p.nickname),
        {
          savings: p.savings,
          totalPurchaseAmount: p.purchaseAmount,
          totalCurrentValue: p.evaluation,
          totalAssets: p.totalAssets,
          profitAmount: p.profitAmount,
          profitRate: p.profitRate,
          totalProfitAmount: p.profitAmount,
          totalProfitRate: p.profitRate,
          unrealizedProfitAmount: p.profitAmount,
          hasRealPrices: true,
          updatedAt: new Date(`${SESSION_DATE}T00:00:00+09:00`),
        },
        { merge: true }
      );
      console.log(`✅ ${p.nickname}: ${p.profitRate}% (${p.profitAmount.toLocaleString()}원)`);
      ok++;
    } catch (e) {
      console.error(`❌ ${p.nickname} 실패:`, e);
    }
  }
  console.log(`\n🎉 완료: ${ok}/${FINAL_DATA.length}명 업로드됨\n`);
}

if (typeof window !== 'undefined') {
  (window as any).uploadFinalPortfolio20260613 = uploadFinalPortfolio20260613;
}