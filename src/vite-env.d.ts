/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_GEMINI_API_KEY?: string;
  readonly VITE_ADMIN_PASSWORD?: string;
  readonly VITE_USE_FIREBASE_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  updatePricesFor20260613?: () => Promise<{ updateCount: number }>;
  updateAssetPricesForSession?: (
    batch: {
      sessionDate: string;
      exchangeRate?: number;
      priceUpdates: Record<string, { usd?: number; krw: number }>;
    },
    options?: { dryRun?: boolean }
  ) => Promise<{
    updateCount: number;
    updateLog: Array<{
      name: string;
      type: 'USD' | 'KRW';
      oldPrice?: number;
      newPrice: number;
      changePercent: string;
    }>;
  }>;
  recalculateAllPortfolios?: () => Promise<{ portfolioCount: number }>;
  fixMicronTeslaMarketRegionInFirestore?: () => Promise<{ updated: string[] }>;
  seedInitialPortfolios20260529?: () => Promise<{
    success: boolean;
    message: string;
    logicalName: string;
    seededNicknames: string[];
  }>;
}
