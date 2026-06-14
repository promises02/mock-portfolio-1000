import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  getDoc,
  getDocFromServer
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, getAllCommunityCustomAssets, fetchRealtimePriceSnapshot, sellAsset, persistPortfolio, subscribeMarketPrices, subscribeGlobalExchangeRate, subscribeCommunityCustomAssets, SHARED_CONFIG_DOC_ID, createPortfolio, updatePortfolioValues, resolveInitialCapital, repairPortfolioIfNeeded, setAdminSessionPassword, clearAdminSessionPassword } from './firebase';
import { AssetItem, CustomAsset, Portfolio, MarketPriceMap } from './types';
import { LoginModal } from './components/LoginModal';
import { AssetInputForm } from './components/AssetInputForm';
import { PortfolioChart } from './components/PortfolioChart';
import { ComparisonDashboard } from './components/ComparisonDashboard';
import { AdminLoginPage } from './components/admin/AdminLoginPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CustomAssetModal } from './components/CustomAssetModal';
import { RecommendedAssetsSection } from './components/RecommendedAssetsSection';
import { BudgetSummaryCard } from './components/BudgetSummaryCard';
import { SellAssetModal } from './components/SellAssetModal';
import { formatCommas, formatKRW, inferAssetMarket, inferAssetSector, enrichAssetCurrencyFields, DEFAULT_EXCHANGE_RATE } from './utils';
import { computeSellPreview, getProfitStyle, computePortfolioProfitSummary, derivePortfolioCash, PORTFOLIO_STARTING_CAPITAL, isUsMarketAsset, buildCatalogPriceMap, getTotalPurchaseAmountKrw, computeBrokeragePortfolioMetrics } from './utils/portfolioPnL';
import { getPresetByName } from './presets';
import { 
  Coins, 
  LogOut, 
  Save, 
  Lightbulb, 
  CheckCircle2, 
  AlertTriangle,
  Sparkles,
  PieChart as PieChartIcon,
  TrendingUp,
  ArrowRightLeft,
  ArrowUpDown,
  Plus
} from 'lucide-react';

const TOTAL_BUDGET = 10000000; // 10 Million KRW

export default function App() {
  const [nickname, setNickname] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [allPortfolios, setAllPortfolios] = useState<Portfolio[]>([]);
  const [reason, setReason] = useState<string>('');
  const [isSavingReason, setIsSavingReason] = useState<boolean>(false);
  
  const [marketPrices, setMarketPrices] = useState<MarketPriceMap>({});
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminModeStep, setAdminModeStep] = useState<'login' | 'dashboard'>('login');
  const [cumulativeRealizedProfit, setCumulativeRealizedProfit] = useState<number>(0);
  const [cashBalance, setCashBalance] = useState<number>(TOTAL_BUDGET);
  const [initialCapital, setInitialCapital] = useState<number>(PORTFOLIO_STARTING_CAPITAL);
  
  // Trading Form elements
  const [tradeAssetIndex, setTradeAssetIndex] = useState<number>(-1);
  const [sellQuantity, setSellQuantity] = useState<number>(1);
  const [isSellDeskSubmitting, setIsSellDeskSubmitting] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [marketIndices, setMarketIndices] = useState<{
    kospi: number;
    nasdaq: number;
    sp500: number;
    usdKrw: number;
    updatedAtLabel: string;
  }>({
    kospi: 8476,
    nasdaq: 26972.65,
    sp500: 7580.06,
    usdKrw: 1500,
    updatedAtLabel: '로딩 중...'
  });
  
  // UI and Status States
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingRealPrices, setIsCheckingRealPrices] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showCustomAssetModal, setShowCustomAssetModal] = useState(false);
  const [customAssetsVersion, setCustomAssetsVersion] = useState(0);
  const [communityCustomAssets, setCommunityCustomAssets] = useState<CustomAsset[]>([]);
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [sellModalIndex, setSellModalIndex] = useState<number | null>(null);
  const [isSellSubmitting, setIsSellSubmitting] = useState(false);
  const portfolioHydratedFor = useRef<string | null>(null);
  const repairAttemptedFor = useRef<string | null>(null);

  // 1. Connection Validation and restore nickname from localStorage
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();

    const savedNickname = localStorage.getItem('currentNickname');
    if (savedNickname) {
      setNickname(savedNickname);
    }
  }, []);

  // 1.5. Fetch Real-time Market Indices (KOSPI, NASDAQ 100, S&P 500, USD/KRW)
  useEffect(() => {
    async function fetchIndices(attempt = 1) {
      try {
        const response = await fetch('/api/market-indices');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setMarketIndices({
              kospi: Number(data.kospi) || 8476,
              nasdaq: Number(data.nasdaq) || 26972.65,
              sp500: Number(data.sp500) || 7580.06,
              usdKrw: Number(data.usdKrw) || 1500,
              updatedAtLabel: data.updatedAtLabel || '실시간 연계 완료'
            });
            return; // Success!
          }
        }
        throw new Error(`Server returned non-ok status: ${response.status}`);
      } catch (err) {
        console.warn(`Failed to fetch real-time market indices (attempt ${attempt}/3):`, err);
        if (attempt < 3) {
          setTimeout(() => {
            fetchIndices(attempt + 1);
          }, 2000); // Retry after 2 seconds
        } else {
          console.error('Final attempt to fetch real-time market indices failed:', err);
        }
      }
    }
    fetchIndices();
  }, []);

  // Phase 6: 실시간 환율 API → 시장 지수 표시용 (포트폴리오 환율과 별개)
  useEffect(() => {
    let mounted = true;

    const refreshLiveExchangeRate = async () => {
      try {
        const snapshot = await fetchRealtimePriceSnapshot();
        if (!mounted || !snapshot.usdKrw || snapshot.usdKrw <= 0) return;

        const rounded = Math.round(snapshot.usdKrw);
        setMarketIndices((prev) => ({ ...prev, usdKrw: rounded }));
      } catch (err) {
        console.warn('Failed to fetch live USD/KRW rate:', err);
      }
    };

    refreshLiveExchangeRate();
    const timer = setInterval(refreshLiveExchangeRate, 10 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  // 2. Real-time Listeners for community portfolios
  useEffect(() => {
    const path = 'portfolios';
    const q = query(collection(db, path));
    
    setIsLoadingDb(true);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Portfolio[] = [];
        snapshot.forEach((snapDoc) => {
          if (snapDoc.id === SHARED_CONFIG_DOC_ID) return;
          list.push({
            nickname: snapDoc.id,
            ...snapDoc.data(),
          } as Portfolio);
        });

        setAllPortfolios(list);
        setIsLoadingDb(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );

    return () => unsubscribe();
  }, []);

  // Market price overrides (admin adjustments + realtime sync)
  useEffect(() => {
    const unsubscribe = subscribeMarketPrices(setMarketPrices);
    return () => unsubscribe();
  }, []);

  // 3. Load user's saved data once they log in (초기 1회만 — 실시간 리스너가 로컬 매수/매도 덮어쓰지 않도록)
  useEffect(() => {
    if (!nickname || allPortfolios.length === 0) return;
    const existing = allPortfolios.find((p) => p.nickname === nickname);
    if (!existing) return;
    if (portfolioHydratedFor.current === nickname) return;

    portfolioHydratedFor.current = nickname;
    setAssets(existing.assets || []);
    setReason(existing.reason || '');
    setCumulativeRealizedProfit(existing.cumulativeRealizedProfit ?? 0);
    setInitialCapital(resolveInitialCapital(existing));
    setCashBalance(
      derivePortfolioCash(
        existing.assets || [],
        existing.cumulativeRealizedProfit ?? 0,
        undefined,
        exchangeRate
      )
    );
  }, [nickname, allPortfolios, exchangeRate]);

  useEffect(() => {
    return subscribeGlobalExchangeRate(setExchangeRate);
  }, []);

  useEffect(() => {
    return subscribeCommunityCustomAssets(setCommunityCustomAssets);
  }, []);

  const refreshCommunityCustomAssets = () => {
    getAllCommunityCustomAssets()
      .then(setCommunityCustomAssets)
      .catch((err) => console.warn('Failed to load community custom assets:', err));
  };

  const refreshPortfolioFromFirestore = async () => {
    if (!nickname) return;
    try {
      const snap = await getDoc(doc(db, 'portfolios', nickname));
      if (snap.exists()) {
        const data = snap.data() as Portfolio;
        setAssets(data.assets || []);
        if (data.cumulativeRealizedProfit !== undefined) {
          setCumulativeRealizedProfit(data.cumulativeRealizedProfit);
        }
        setInitialCapital(resolveInitialCapital(data));
        setCashBalance(
          derivePortfolioCash(
            data.assets || [],
            data.cumulativeRealizedProfit ?? 0,
            undefined,
            effectiveExchangeRate
          )
        );
      }
    } catch (err) {
      console.warn('Failed to refresh portfolio:', err);
    }
  };

  useEffect(() => {
    refreshCommunityCustomAssets();
  }, [nickname, customAssetsVersion]);

  const effectiveExchangeRate = exchangeRate;

  // Calculations (rounded to nearest integer for budget matches to avoid micro inaccuracies)
  const activeTotalBudget = PORTFOLIO_STARTING_CAPITAL + cumulativeRealizedProfit;
  const totalInvested = useMemo(
    () =>
      assets.reduce(
        (sum, item) => sum + getTotalPurchaseAmountKrw(item, effectiveExchangeRate),
        0
      ),
    [assets, effectiveExchangeRate]
  );
  const savings = useMemo(
    () => derivePortfolioCash(assets, cumulativeRealizedProfit, undefined, effectiveExchangeRate),
    [assets, cumulativeRealizedProfit, effectiveExchangeRate]
  );

  useEffect(() => {
    setCashBalance(savings);
  }, [savings]);

  const catalogPrices = useMemo(
    () => buildCatalogPriceMap(communityCustomAssets, effectiveExchangeRate),
    [communityCustomAssets, effectiveExchangeRate]
  );

  const rankedPortfolios = useMemo(() => {
    return [...allPortfolios]
      .map((portfolio) => {
        const initialCapital = resolveInitialCapital(portfolio);
        const metrics = computeBrokeragePortfolioMetrics(
          portfolio.assets || [],
          portfolio.cumulativeRealizedProfit ?? 0,
          initialCapital,
          marketPrices,
          effectiveExchangeRate,
          catalogPrices
        );
        return {
          ...portfolio,
          savings: metrics.savings,
          totalAssets: metrics.totalAssets,
          totalCurrentValue: metrics.totalCurrentValue,
          totalProfitAmount: metrics.totalProfitAmount,
          totalProfitRate: metrics.totalProfitRate,
        };
      })
      .sort((a, b) => (b.totalProfitRate ?? 0) - (a.totalProfitRate ?? 0));
  }, [allPortfolios, marketPrices, effectiveExchangeRate, catalogPrices]);

  useEffect(() => {
    if (!nickname || repairAttemptedFor.current === nickname) return;
    repairAttemptedFor.current = nickname;
    void repairPortfolioIfNeeded(nickname, {
      marketPrices,
      exchangeRate: effectiveExchangeRate,
      catalogPrices,
    }).then((repaired) => {
      if (repaired) {
        void refreshPortfolioFromFirestore();
      }
    });
  }, [nickname, marketPrices, effectiveExchangeRate, catalogPrices]);

  const isOverBudget = Math.round(totalInvested) > activeTotalBudget;

  const heldAssets = useMemo(
    () => assets.filter((a) => a.name.trim() !== '' && a.quantity > 0),
    [assets]
  );

  const selectedSellAsset =
    tradeAssetIndex >= 0 && tradeAssetIndex < heldAssets.length
      ? heldAssets[tradeAssetIndex]
      : null;

  useEffect(() => {
    if (heldAssets.length === 0) {
      setTradeAssetIndex(-1);
      return;
    }
    if (tradeAssetIndex < 0 || tradeAssetIndex >= heldAssets.length) {
      setTradeAssetIndex(0);
    }
  }, [heldAssets, tradeAssetIndex]);

  useEffect(() => {
    if (!selectedSellAsset) return;
    const maxQty = Math.floor(selectedSellAsset.quantity);
    setSellQuantity((prev) => Math.min(Math.max(1, prev), maxQty));
  }, [tradeAssetIndex, selectedSellAsset?.quantity, selectedSellAsset?.name]);

  const portfolioValues = useMemo(
    () =>
      updatePortfolioValues(
        assets,
        savings,
        initialCapital,
        marketPrices,
        effectiveExchangeRate,
        catalogPrices
      ),
    [assets, savings, initialCapital, marketPrices, effectiveExchangeRate, catalogPrices]
  );

  const liveAssetEvaluation = portfolioValues.totalCurrentValue;
  const liveTotalAssets = portfolioValues.totalAssets;
  const liveTotalProfitAmount = portfolioValues.totalProfitAmount;
  const liveTotalProfitRate = portfolioValues.totalProfitRate;
  const unrealizedProfit = portfolioValues.profitAmount;
  const profitSummary = useMemo(
    () =>
      computePortfolioProfitSummary(
        assets,
        marketPrices,
        effectiveExchangeRate,
        cumulativeRealizedProfit,
        savings,
        catalogPrices,
        initialCapital
      ),
    [assets, marketPrices, effectiveExchangeRate, cumulativeRealizedProfit, savings, catalogPrices, initialCapital]
  );
  const realizedProfitTotal = profitSummary.realizedProfit;
  const isYieldModified = assets.some(a => {
    const activeCurrentPrice = marketPrices[a.name.trim()] !== undefined
      ? marketPrices[a.name.trim()]
      : a.currentPrice;
    return activeCurrentPrice !== undefined && activeCurrentPrice !== a.price;
  });

  const existingPortfolio = allPortfolios.find((p) => p.nickname === nickname);
  const isReasonSynced = reason.trim() === (existingPortfolio?.reason || '').trim();

  const persistCurrentPortfolio = useCallback(
    async (nextAssets: AssetItem[], nextCumulativeProfit = cumulativeRealizedProfit) => {
      if (!nickname) {
        throw new Error('먼저 로그인(닉네임 설정) 해주세요.');
      }

      const saved = await persistPortfolio({
        nickname,
        assets: nextAssets,
        reason,
        cumulativeRealizedProfit: nextCumulativeProfit,
        marketPrices,
        exchangeRate: effectiveExchangeRate,
        catalogPrices,
        savings,
      });

      setAssets(saved.assets);
      setCumulativeRealizedProfit(saved.cumulativeRealizedProfit);
      setCashBalance(saved.savings);
      portfolioHydratedFor.current = nickname;
      return saved;
    },
    [nickname, reason, cumulativeRealizedProfit, marketPrices, effectiveExchangeRate, catalogPrices, savings]
  );

  const sellPreview = selectedSellAsset
    ? computeSellPreview(
        selectedSellAsset,
        sellQuantity,
        marketPrices,
        effectiveExchangeRate,
        savings,
        catalogPrices
      )
    : null;

  const sellProfitStyle = sellPreview
    ? getProfitStyle(sellPreview.realizedProfit)
    : getProfitStyle(0);

  // Manual Trigger: Fetch AI actual current prices and calculate yield simulations
  const handleCheckRealPrices = async (targetAssets = assets) => {
    if (targetAssets.length === 0) return;
    setIsCheckingRealPrices(true);
    setErrorMsg('');
    setSuccessMsg('');
    
    try {
      const cleanAssets = targetAssets.filter(
        (a) => a.name.trim() !== '' && a.price > 0 && a.quantity > 0
      );

      if (cleanAssets.length === 0) {
        setErrorMsg('실제 가격을 조회할 자산 항목을 먼저 입력해 주세요.');
        setIsCheckingRealPrices(false);
        return;
      }

      const response = await fetch('/api/fetch-prices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assets: cleanAssets }),
      });
      
      if (!response.ok) {
        throw new Error('실시간 가격 조회 서버 응답 오류');
      }
      
      const data = await response.json();
      if (data.success && data.prices) {
        const updatedAssets = assets.map((asset) => {
          const matchingPrice = data.prices.find((p: any) => p.name === asset.name);
          if (matchingPrice) {
            return {
              ...asset,
              currentPrice: matchingPrice.actualPrice,
              sourceUrl: matchingPrice.sourceUrl,
              searchReasoning: matchingPrice.searchReasoning,
            };
          }
          return asset;
        });
        
        setAssets(updatedAssets);
        setSuccessMsg('AI 기반 국내/외 주요 거래소 실시간 가격 조회 및 수익률 대조 성공!');
        setTimeout(() => setSuccessMsg(''), 5500);
        return updatedAssets;
      } else {
        throw new Error(data.error || '거래소 가격 목록 획득 실패');
      }
    } catch (error) {
      console.error('AI Price Fetch Err:', error);
      setErrorMsg('실제 가격 정보를 조회하는 중 오류가 발생했습니다. 잠시 후 상단의 조회 버튼을 클릭해 주세요.');
      setTimeout(() => setErrorMsg(''), 5500);
    } finally {
      setIsCheckingRealPrices(false);
    }
  };

  // Save specifically the reasoning / investment strategy text
  const handleSaveReason = async () => {
    if (!nickname) return;
    setIsSavingReason(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const docRef = doc(db, 'portfolios', nickname);
      await setDoc(docRef, {
        reason: reason.trim(),
        updatedAt: new Date()
      }, { merge: true });

      setSuccessMsg('작성하신 투자 전략 및 사유가 실시간 대시보드에 성공적으로 저장되었습니다!');
      setTimeout(() => setSuccessMsg(''), 4500);
    } catch (error) {
      console.error('Error saving reason:', error);
      setErrorMsg('투자 사유 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      setTimeout(() => setErrorMsg(''), 4500);
    } finally {
      setIsSavingReason(false);
    }
  };

  // Save portfolio logic with auto actual price fetching via Gemini
  const handleSavePortfolio = async () => {
    if (!nickname) return;
    
    setIsSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    if (isOverBudget) {
      setErrorMsg(`투자 설정 금액의 총합이 가용 자본 한도(${formatCommas(activeTotalBudget)}원)를 초과하여 저장할 수 없습니다.`);
      setIsSaving(false);
      return;
    }

    const path = 'portfolios';
    try {
      const saved = await persistPortfolio({
        nickname,
        assets,
        reason,
        cumulativeRealizedProfit,
        marketPrices,
        exchangeRate: effectiveExchangeRate,
        catalogPrices,
        savings,
      });
      setAssets(saved.assets);
      setCumulativeRealizedProfit(saved.cumulativeRealizedProfit);
      setCashBalance(saved.savings);
      portfolioHydratedFor.current = nickname;

      setSuccessMsg('실시간 가격 분석이 정상 반영되어 대시보드 리더보드에 공유되었습니다!');
      setTimeout(() => setSuccessMsg(''), 5500);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${path}/${nickname}`, nickname);
    } finally {
      setIsSaving(false);
    }
  };

  // Nickname login: check Firestore doc or create new portfolio
  const handleLogin = async (rawNickname: string) => {
    const cleanName = rawNickname.trim();
    if (!cleanName) {
      throw new Error('닉네임을 입력해주세요.');
    }
    if (cleanName.length > 20) {
      throw new Error('닉네임은 최대 20자까지 가능합니다.');
    }

    const docRef = doc(db, 'portfolios', cleanName);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data() as Portfolio;
      portfolioHydratedFor.current = cleanName;
      setAssets(data.assets || []);
      setReason(data.reason || '');
      setCumulativeRealizedProfit(data.cumulativeRealizedProfit ?? 0);
      setInitialCapital(resolveInitialCapital(data));
      setCashBalance(
        derivePortfolioCash(
          data.assets || [],
          data.cumulativeRealizedProfit ?? 0,
          undefined,
          exchangeRate
        )
      );
    } else {
      const newPortfolio = createPortfolio(cleanName, exchangeRate);
      await setDoc(docRef, {
        ...newPortfolio,
        reason: '',
      });
      setAssets([]);
      setReason('');
      setCumulativeRealizedProfit(0);
      setInitialCapital(newPortfolio.initialCapital ?? PORTFOLIO_STARTING_CAPITAL);
      setCashBalance(newPortfolio.savings);
      portfolioHydratedFor.current = cleanName;
    }

    localStorage.setItem('currentNickname', cleanName);
    setNickname(cleanName);
  };

  // Logout handler
  const handleLogout = () => {
    localStorage.removeItem('currentNickname');
    portfolioHydratedFor.current = null;
    setNickname(null);
    setAssets([]);
    setReason('');
    setCumulativeRealizedProfit(0);
    setCashBalance(TOTAL_BUDGET);
    setInitialCapital(PORTFOLIO_STARTING_CAPITAL);
  };

  // logicalName: enhancedSellSimulator — 매도 실행 (firebase.sellAsset)
  const executeSell = async (assetName: string, qty: number): Promise<boolean> => {
    if (!nickname) {
      setTradeMsg({ type: 'error', text: '먼저 로그인(닉네임 설정) 해주세요.' });
      return false;
    }

    const integerQty = Math.floor(qty);
    if (!Number.isInteger(integerQty) || integerQty <= 0) {
      setTradeMsg({ type: 'error', text: '매도 수량은 1 이상의 정수여야 합니다.' });
      return false;
    }

    const trimmedName = assetName.trim();
    const held = assets.find((a) => a.name.trim() === trimmedName);
    if (!held) {
      setTradeMsg({ type: 'error', text: '보유하고 있지 않은 자산은 매도할 수 없습니다.' });
      return false;
    }

    const sellPrice = computeSellPreview(
      held,
      integerQty,
      marketPrices,
      effectiveExchangeRate,
      savings,
      catalogPrices
    ).sellPriceKrw;

    setIsSaving(true);
    try {
      const result = await sellAsset(nickname, {
        assetName: trimmedName,
        quantity: integerQty,
        sellPriceKrw: sellPrice,
      });

      setAssets(result.assets);
      setCumulativeRealizedProfit(result.newCumulativeRealizedProfit);
      setCashBalance(result.newSavings);
      portfolioHydratedFor.current = nickname;
      setSellQuantity(1);

      setTradeMsg({
        type: 'success',
        text: `${result.message} · 현금 ${formatCommas(result.previousSavings)}원 → ${formatCommas(result.newSavings)}원`,
      });

      await refreshPortfolioFromFirestore();
      portfolioHydratedFor.current = nickname;
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '매도 처리 중 오류가 발생했습니다.';
      setTradeMsg({ type: 'error', text: message });
      return false;
    } finally {
      setIsSaving(false);
      setTimeout(() => setTradeMsg(null), 8500);
    }
  };

  // Live simulation buy/sell execution engine
  const handleExecuteTrade = async (assetName: string, type: 'buy' | 'sell', qtyStr: string) => {
    if (type === 'sell') {
      const qty = parseInt(qtyStr, 10);
      await executeSell(assetName, qty);
      return;
    }

    if (!nickname) {
      setTradeMsg({ type: 'error', text: '먼저 로그인(닉네임 설정) 해주세요.' });
      return;
    }
    const qty = parseFloat(qtyStr) || 0;
    if (qty <= 0) {
      setTradeMsg({ type: 'error', text: '올바른 거래 수량을 입력해 주세요.' });
      return;
    }

    const trimmedName = assetName.trim();
    if (!trimmedName) {
      setTradeMsg({ type: 'error', text: '거래할 자산을 선택하거나 입력해 주세요.' });
      return;
    }

    // Determine target current price
    const activePrice = marketPrices[trimmedName] !== undefined
      ? marketPrices[trimmedName]
      : 0;
    
    let resolvedPrice = activePrice;
    if (resolvedPrice <= 0) {
      // Find preset price
      const preset = getPresetByName(trimmedName.toLowerCase());
      if (preset) {
        resolvedPrice = preset.price;
      } else {
        const held = assets.find(a => a.name.trim() === trimmedName);
        resolvedPrice = held ? (held.currentPrice ?? held.price) : 100000;
      }
    }

    const totalCost = Math.round(resolvedPrice * qty);
    const existingAsset = assets.find(a => a.name.trim() === trimmedName);

    let nextAssets = [...assets];
    let nextRealizedProfit = cumulativeRealizedProfit;

    if (type === 'buy') {
      if (savings < totalCost) {
        setTradeMsg({ 
          type: 'error', 
          text: `가용 대기현금 잔액(₩${formatCommas(savings)}원)이 부족합니다. (필요 금액: ₩${formatCommas(totalCost)}원)` 
        });
        return;
      }

      if (existingAsset) {
        // Average the buy price
        const oldQty = existingAsset.quantity;
        const oldPrice = existingAsset.price;
        const newQty = oldQty + qty;
        const newAvgPrice = Math.round((oldPrice * oldQty + resolvedPrice * qty) / newQty);

        nextAssets = assets.map(a => {
          if (a.name.trim() === trimmedName) {
            return {
              ...a,
              price: newAvgPrice,
              quantity: newQty,
              currentPrice: resolvedPrice
            };
          }
          return a;
        });
      } else {
        // Add new asset
        const marketGroup = inferAssetMarket(trimmedName, 'stock');
        const sector = inferAssetSector(trimmedName, 'stock');
        
        nextAssets.push(
          enrichAssetCurrencyFields(
            {
              name: trimmedName,
              type: 'stock',
              price: resolvedPrice,
              quantity: qty,
              currentPrice: resolvedPrice,
              marketGroup,
              sector,
            },
            effectiveExchangeRate
          )
        );
      }

      setTradeMsg({
        type: 'success',
        text: `✓ [매수 완료] ${trimmedName} ${qty}주를 단가 ₩${formatCommas(resolvedPrice)}원에 매수하였습니다! (총 결제: ₩${formatCommas(totalCost)}원)`
      });
    }

    // Update states (buy only — sell handled by executeSell)
    setAssets(nextAssets);
    setCumulativeRealizedProfit(nextRealizedProfit);

    setIsSaving(true);
    try {
      await persistCurrentPortfolio(nextAssets, nextRealizedProfit);
    } catch (error) {
      console.error('Error saving during trade:', error);
      setTradeMsg({ type: 'error', text: '매수 기록 저장 중 오류가 발생했습니다.' });
    } finally {
      setIsSaving(false);
    }

    setTimeout(() => {
      setTradeMsg(null);
    }, 8500);
  };

  const handleOpenSellModal = (index: number) => {
    setSellModalIndex(index);
  };

  const handleConfirmSell = async (quantity: number) => {
    if (sellModalIndex == null) return;
    const asset = assets[sellModalIndex];
    if (!asset) return;

    setIsSellSubmitting(true);
    try {
      const ok = await executeSell(asset.name, quantity);
      if (ok) setSellModalIndex(null);
    } finally {
      setIsSellSubmitting(false);
    }
  };

  const handleSellDeskSubmit = async () => {
    if (!selectedSellAsset || !sellPreview) return;
    setIsSellDeskSubmitting(true);
    try {
      await executeSell(selectedSellAsset.name, sellQuantity);
    } finally {
      setIsSellDeskSubmitting(false);
    }
  };

  const adjustSellQuantity = (delta: number) => {
    if (!selectedSellAsset) return;
    const maxQty = Math.floor(selectedSellAsset.quantity);
    setSellQuantity((prev) => Math.min(maxQty, Math.max(1, prev + delta)));
  };

  const renderNavbar = () => (
    <header className="flex items-center justify-between px-6 sm:px-8 py-4 bg-white border-b border-slate-200 shrink-0 sticky top-0 z-40 shadow-sm/5 bg-white/95 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-650 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-inner select-none font-sans">
          ₩
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold tracking-tight uppercase text-slate-800">
            Invest10M <span className="text-slate-400 font-medium text-xs sm:text-sm ml-2">| 모의 투자 챌린지</span>
          </h1>
          <p className="text-[10px] text-slate-400 font-sans tracking-wide">
            Real-time Portfolio Sim with Gemini AI
          </p>
        </div>
      </div>

      {nickname && (
        <div className="flex items-center gap-4 sm:gap-6">
          <div
            className="hidden md:flex flex-col gap-0.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl"
            data-logical-name="multiCurrencySupport"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">환율</span>
              <span className="text-xs font-mono font-bold text-amber-900">
                1 USD = {formatCommas(effectiveExchangeRate)}원
              </span>
            </div>
            <span className="text-[9px] text-amber-700/80 font-medium">
              환율은 관리자 모드에서 수정 가능합니다
            </span>
          </div>

          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">나의 예금/저금 잔액</p>
            <p className="text-lg font-mono font-bold text-emerald-600">{formatCommas(savings)}원</p>
          </div>
          <div className="h-8 w-[1px] bg-slate-200 hidden sm:block"></div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs sm:text-sm font-bold text-slate-800">{nickname} 님</p>
              <p className="text-[10px] text-slate-400">온라인 참여자</p>
            </div>
            <div className="w-9 h-9 bg-slate-150 rounded-full border-2 border-emerald-500 flex items-center justify-center text-slate-700 font-bold text-xs shadow-sm">
              {nickname.slice(0, 2).toUpperCase()}
            </div>
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-500 rounded-xl hover:bg-rose-50 border border-slate-200 cursor-pointer transition shadow-sm ml-1"
              title="로그아웃"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  );

  const exitAdminMode = () => {
    clearAdminSessionPassword();
    setIsAdminMode(false);
    setAdminModeStep('login');
  };

  // Admin full-page flow (no nickname, in-memory only — refresh requires re-login)
  if (!nickname && isAdminMode && adminModeStep === 'dashboard') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
        <div>
          {renderNavbar()}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <AdminDashboard onLogout={exitAdminMode} />
          </main>
        </div>
        <footer className="bg-slate-900 px-6 py-4 text-center select-none shrink-0 border-t border-slate-800">
          <p className="text-[10px] text-slate-400 font-semibold font-mono">
            © 2026 INVEST10M • 관리자 모드
          </p>
        </footer>
      </div>
    );
  }

  if (!nickname) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
        <div>
          {renderNavbar()}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            {isAdminMode && adminModeStep === 'login' ? (
              <AdminLoginPage
                onSuccess={(password) => {
                  setAdminSessionPassword(password);
                  setAdminModeStep('dashboard');
                }}
                onBack={exitAdminMode}
              />
            ) : (
              <LoginModal
                onLogin={handleLogin}
                onEnterAdminMode={() => {
                  setIsAdminMode(true);
                  setAdminModeStep('login');
                }}
              />
            )}
          </main>
        </div>
        <footer className="bg-slate-900 px-6 py-4 text-center select-none shrink-0 border-t border-slate-800">
          <p className="text-[10px] text-slate-400 font-semibold font-mono">
            © 2026 INVEST10M • AI 실시간 시세 연계 모의 포트폴리오
          </p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between font-sans">
      <div>
        {renderNavbar()}

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          {/* Main workspace split columns */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Input column */}
            <div className="lg:col-span-7 space-y-6">
              <BudgetSummaryCard
                totalInvested={totalInvested}
                savings={savings}
                totalBudget={activeTotalBudget}
              />

              <div id="creator-card" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-150/50 mb-6">
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">
                      포트폴리오 설계서 작성
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <span>가용 한도 설정 자금 내역: </span>
                      <span className="font-bold underline text-indigo-700">₩{formatCommas(activeTotalBudget)}원</span>
                      <span>(초기자본 1,000만원 + 누적 매도 수익)</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCustomAssetModal(true)}
                    className="shrink-0 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    자산 직접 추가
                  </button>
                </div>

                {nickname && (
                  <div className="mb-6">
                    <RecommendedAssetsSection
                      nickname={nickname}
                      availableCash={savings}
                      exchangeRate={effectiveExchangeRate}
                      communityCustomAssets={communityCustomAssets}
                      assets={assets}
                      onChangeAssets={setAssets}
                      onPersistPortfolio={persistCurrentPortfolio}
                      totalInvested={totalInvested}
                      totalBudget={activeTotalBudget}
                      marketPrices={marketPrices}
                      catalogPrices={catalogPrices}
                      customAssetsVersion={customAssetsVersion}
                      onOpenCustomAssetModal={() => setShowCustomAssetModal(true)}
                      onBuySuccess={(msg) => {
                        setSuccessMsg(msg);
                        setTimeout(() => setSuccessMsg(''), 4500);
                      }}
                      onBuyError={(msg) => {
                        setErrorMsg(msg);
                        setTimeout(() => setErrorMsg(''), 4500);
                      }}
                    />
                  </div>
                )}

                <AssetInputForm
                  assets={assets}
                  onChangeAssets={setAssets}
                  savings={savings}
                  marketPrices={marketPrices}
                  catalogPrices={catalogPrices}
                  allPortfolios={rankedPortfolios}
                  exchangeRate={effectiveExchangeRate}
                  communityCustomAssets={communityCustomAssets}
                  onSellAsset={handleOpenSellModal}
                />

                <div className="mt-6 pt-6 border-t border-slate-150">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider font-sans flex items-center gap-1.5">
                      <span>💡 포트폴리오 구성 사유 및 투자 전략</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (실시간 대시보드 및 랭킹에 즉시 공개됩니다)
                    </span>
                  </div>
                  <textarea
                    id="portfolio-reason-input"
                    rows={4}
                    maxLength={1000}
                    placeholder="예: 금리 변동성에 대응하기 위해 안전 대기자산인 파킹통장(현금) 비중을 20%로 유지하고, 장기 우상향하는 미국 S&P500 지수 ETF와 고배당 SCHD를 적극 편입하는 한편, AI 메가 트렌드를 이끄는 미국 엔비디아와 브룩필드 금융 지주사의 미래 성장에 분산 투자하였습니다."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-250 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl p-3.5 text-xs text-slate-700 placeholder-slate-450 outline-none transition resize-none leading-relaxed font-sans"
                  />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2.5">
                    <div className="text-[10px] text-slate-400 font-medium font-sans">
                      <span>설계 전략이나 분배 종목 군의 투자 아이디어를 넉넉하게 작성해 보세요.</span>
                    </div>
                    
                    <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0 select-none">
                      <span className={`text-[10px] font-mono font-bold ${reason.length >= 1000 ? 'text-rose-500' : 'text-slate-400'}`}>
                        {reason.length} / 1000자
                      </span>

                      <button
                        type="button"
                        onClick={handleSaveReason}
                        disabled={isSavingReason || !nickname}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                          isReasonSynced
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-250 hover:bg-emerald-50 cursor-default shadow-none'
                            : 'bg-indigo-600 hover:bg-indigo-750 text-white border border-indigo-700 active:scale-[0.98]'
                        }`}
                      >
                        {isSavingReason ? (
                          <>
                            <span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>저장 중...</span>
                          </>
                        ) : isReasonSynced ? (
                          <>
                            <span className="text-emerald-600 font-black">✓</span>
                            <span>저장 완료</span>
                          </>
                        ) : (
                          <>
                            <span>💾</span>
                            <span>전략 저장하기</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Trading Desk — logicalName: enhancedSellSimulator */}
                <div
                  className="mt-6 pt-6 border-t border-slate-150 border-2 border-indigo-500/30 rounded-2xl p-5 sm:p-6 relative overflow-hidden"
                  data-logical-name="enhancedSellSimulator"
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-55/15 rounded-full blur-xl pointer-events-none" />

                  <h3 className="text-xs md:text-sm font-black text-slate-850 flex items-center gap-2 mb-2">
                    <span className="p-1 px-1.5 bg-blue-50 text-blue-700 rounded-md text-[10px] font-mono leading-none tracking-widest font-black">📉 SELL ONLY</span>
                    <span>실시간 모의 자산 매도 거래 시뮬레이터</span>
                  </h3>
                  <p className="text-[11px] text-slate-450 leading-relaxed mb-4">
                    보유한 모의 자산만 선택하여 매도할 수 있습니다. 실시간 시세 기준으로 손익을 미리 확인한 뒤 매도하세요.
                  </p>

                  {tradeMsg && (
                    <div className={`p-4 rounded-xl text-xs font-bold leading-relaxed mb-4 border transition ${
                      tradeMsg.type === 'success'
                        ? 'bg-rose-50/55 text-rose-800 border-rose-200'
                        : 'bg-blue-50/55 text-blue-800 border-blue-200'
                    }`}>
                      {tradeMsg.text}
                    </div>
                  )}

                  {heldAssets.length === 0 ? (
                    <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                      <p className="text-sm font-bold text-slate-500">보유 중인 자산이 없습니다.</p>
                      <p className="text-xs text-slate-400 mt-1">위에서 자산을 매수한 뒤 이용하세요.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                          매도할 종목 선택
                        </label>
                        <select
                          value={tradeAssetIndex}
                          onChange={(e) => setTradeAssetIndex(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-250 focus:border-indigo-400 rounded-xl py-2.5 px-3 text-sm text-slate-800 outline-none transition font-bold cursor-pointer"
                        >
                          {heldAssets.map((asset, index) => (
                            <option key={`${asset.name}-${index}`} value={index}>
                              {asset.name} (보유: {Math.floor(asset.quantity)}주)
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedSellAsset && sellPreview && (
                        <div
                          className="border border-slate-200 rounded-xl overflow-hidden bg-white"
                          data-logical-name="realizedProfitWithCashFlowFixed"
                        >
                          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                            <h4 className="text-base font-extrabold text-slate-900">
                              {selectedSellAsset.name} 매도
                            </h4>
                          </div>

                          <div className="px-4 py-3 space-y-2 border-b border-slate-100 text-sm">
                            {isUsMarketAsset(selectedSellAsset) &&
                            sellPreview.purchasePriceUsd != null &&
                            sellPreview.purchaseExchangeRate != null ? (
                              <>
                                <InfoRow
                                  label="평균 매입가"
                                  value={`${sellPreview.purchasePriceUsd.toFixed(2)} USD (고정!)`}
                                />
                                <InfoRow
                                  label="매입 환율"
                                  value={`${formatCommas(sellPreview.purchaseExchangeRate)}원/USD`}
                                />
                                {sellPreview.currentPriceUsd != null && (
                                  <InfoRow
                                    label="현재가"
                                    value={`${sellPreview.currentPriceUsd.toFixed(2)} USD × ${formatCommas(effectiveExchangeRate)}원 = ${formatCommas(Math.round(sellPreview.sellPriceKrw))}원`}
                                  />
                                )}
                              </>
                            ) : (
                              <InfoRow label="현재가" value={`${formatCommas(Math.round(sellPreview.sellPriceKrw))}원`} />
                            )}
                            <InfoRow label="보유수량" value={`${Math.floor(selectedSellAsset.quantity)}주`} />
                            <div className="flex items-center justify-between gap-3 pt-1">
                              <span className="text-slate-500 shrink-0">매도수량</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => adjustSellQuantity(-1)}
                                  disabled={sellQuantity <= 1}
                                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  ▼
                                </button>
                                <input
                                  type="number"
                                  step={1}
                                  min={1}
                                  max={Math.floor(selectedSellAsset.quantity)}
                                  value={sellQuantity}
                                  onChange={(e) => {
                                    const next = parseInt(e.target.value, 10);
                                    if (Number.isNaN(next)) return;
                                    const maxQty = Math.floor(selectedSellAsset.quantity);
                                    setSellQuantity(Math.min(maxQty, Math.max(1, next)));
                                  }}
                                  className="w-16 text-center text-sm font-mono font-bold px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => adjustSellQuantity(1)}
                                  disabled={sellQuantity >= Math.floor(selectedSellAsset.quantity)}
                                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  ▲
                                </button>
                                <span className="text-xs font-bold text-slate-500">
                                  주 (최대: {Math.floor(selectedSellAsset.quantity)}주)
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="px-4 py-3 space-y-2 border-b border-slate-100 text-sm">
                            <InfoRow label="매도금액" value={`${formatCommas(sellPreview.sellAmount)}원`} bold />
                            <InfoRow label="매입금액" value={`${formatCommas(sellPreview.purchaseAmount)}원`} />
                            {!isUsMarketAsset(selectedSellAsset) && (
                              <InfoRow label="매수가" value={`${formatCommas(Math.round(sellPreview.purchasePriceKrw))}원`} />
                            )}
                          </div>

                          <div className="px-4 py-3 space-y-2 border-b border-slate-100 text-sm">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500">실현 손익</span>
                              <span className={`font-bold ${sellProfitStyle.textClass}`}>
                                {sellPreview.realizedProfit >= 0 ? '+' : ''}
                                {formatCommas(sellPreview.realizedProfit)}원 {sellProfitStyle.icon}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500">수익률</span>
                              <span className={`font-bold text-[13px] ${sellProfitStyle.textClass}`}>
                                {sellPreview.profitRate >= 0 ? '+' : ''}
                                {sellPreview.profitRate.toFixed(2)}% {sellProfitStyle.icon}
                              </span>
                            </div>
                          </div>

                          <div className="px-4 py-3 bg-slate-50/60 text-sm">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 font-bold">예상 현금</span>
                              <span className="font-black font-mono text-slate-900">
                                {formatCommas(sellPreview.cashAfter)}원
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 text-right">
                              {formatCommas(savings)}원 + {formatCommas(sellPreview.sellAmount)}원 (매도금액)
                            </p>
                          </div>

                          <div className="px-4 py-3 flex gap-2 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => setSellQuantity(1)}
                              className="flex-1 py-3 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer"
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={handleSellDeskSubmit}
                              disabled={isSellDeskSubmitting || isSaving}
                              className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white text-sm font-black rounded-xl transition cursor-pointer disabled:opacity-50 active:scale-[0.99]"
                            >
                              {isSellDeskSubmitting || isSaving ? '처리 중...' : '매도 확인'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {assets.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleCheckRealPrices()}
                      disabled={isCheckingRealPrices || isSaving}
                      className="w-full px-4 py-3 bg-emerald-50 hover:bg-emerald-100/85 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Coins className="w-4 h-4 text-emerald-600" />
                      <span>
                        {isCheckingRealPrices 
                          ? 'AI 거래소 전산망 연결 및 시세 조회 중...' 
                          : 'AI 실시간 실제가 사전 조회 및 수익률 계산'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Informative tips regarding simulator */}
              <div className="bg-blue-50/40 border border-blue-100 p-5 rounded-2xl flex items-start space-x-3">
                <Lightbulb className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 leading-relaxed space-y-1">
                  <p className="font-semibold text-slate-700">💡 실제 가격 - 수익률 모의 시뮬레이터 활용법</p>
                  <p>국내 주식(삼성전자 등), US 해외 주식(Tesla, Apple 등), 금(Gold) 혹은 비트코인 등 이름을 입력하세요.</p>
                  <p>
                    <strong>'AI 실제가 사전 조회'</strong> 버튼을 클릭하면, AI가 한국/미국 주식 및 암호화폐 거래소를 종합 검색하여 실제 원화(KRW) 환산 가치에 맞춘 실질 가격을 조회하고 수익률을 연산해 줍니다.
                  </p>
                  <p>최종 설계 후 우측의 <strong>'포트폴리오 실시간 공유저장'</strong>을 하면, 리더보드에 동기화되어 전체 랭킹에 편입됩니다.</p>
                </div>
              </div>
            </div>

            {/* Right chart column */}
            <div className="lg:col-span-5 space-y-6">
              <div id="visual-preview-card" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col items-center">
                <h3 className="text-base font-bold text-slate-800 w-full text-left flex items-center space-x-2 pb-3 border-b border-slate-100">
                  <PieChartIcon className="w-4 h-4 text-indigo-500" />
                  <span>나의 실시간 자산 비중 차트</span>
                </h3>

                <div className="w-full mt-6">
                  <PortfolioChart assets={assets} savings={savings} marketPrices={marketPrices} catalogPrices={catalogPrices} exchangeRate={effectiveExchangeRate} />
                </div>

                {/* Live Real-time Simulation Yield Summary Panel */}
                <div
                  className="w-full mt-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shadow-xs text-xs animate-fade-in text-slate-800"
                  data-logical-name="totalProfitRateCalculationFix"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-250">
                    <span className="font-extrabold text-slate-700 flex items-center space-x-1.5 uppercase font-mono tracking-wide text-[11px]">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      <span>종합 실질 수익률</span>
                    </span>
                    {isYieldModified ? (
                      <span className="bg-indigo-50 text-indigo-700 text-[9px] font-extrabold px-2 py-0.5 rounded border border-indigo-200 uppercase tracking-wider font-mono">
                        수동 시세가 반영됨
                      </span>
                    ) : (
                      <span className="bg-slate-100 text-slate-550 text-[9px] font-extrabold px-2 py-0.5 rounded border border-slate-200 uppercase tracking-wider font-mono">
                        기본 매수가 기준
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">초기 자본:</span>
                      <span className="font-mono font-bold text-slate-700">₩{formatCommas(initialCapital)}원</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">현재 총자산:</span>
                      <span className="font-mono font-bold text-slate-800">₩{formatCommas(liveTotalAssets)}원</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">손익액:</span>
                      <span className={`font-mono font-bold ${
                        liveTotalProfitAmount > 0
                          ? 'text-rose-655'
                          : liveTotalProfitAmount < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {liveTotalProfitAmount > 0 ? '+' : ''}{formatCommas(liveTotalProfitAmount)}원{' '}
                        {liveTotalProfitAmount > 0 ? '▲' : liveTotalProfitAmount < 0 ? '▼' : ''}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-[11px] text-slate-455 font-semibold font-sans">수익률:</span>
                      <span className={`text-2xl font-black font-mono tracking-tight ${
                        liveTotalProfitAmount > 0
                          ? 'text-rose-655'
                          : liveTotalProfitAmount < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {liveTotalProfitRate > 0 ? '▲ +' : liveTotalProfitRate < 0 ? '▼ ' : ''}
                        {liveTotalProfitRate.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-200 border-slate-250">
                    <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">상세 분석</p>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">현금 (파킹통장):</span>
                      <span className="font-mono font-bold text-slate-700">₩{formatCommas(savings)}원</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">평가금액:</span>
                      <span className="font-mono font-bold text-slate-700">₩{formatCommas(liveAssetEvaluation)}원</span>
                    </div>
                    <div className="border-t border-dashed border-slate-200 my-2" />
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">현재 총자산:</span>
                      <span className="font-mono font-bold text-slate-800">₩{formatCommas(liveTotalAssets)}원</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">초기 자본:</span>
                      <span className="font-mono font-bold text-slate-700">₩{formatCommas(initialCapital)}원</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">
                        {liveTotalProfitAmount >= 0 ? '이익:' : '손실:'}
                      </span>
                      <span className={`font-mono font-black ${
                        liveTotalProfitAmount > 0
                          ? 'text-rose-655'
                          : liveTotalProfitAmount < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {liveTotalProfitAmount > 0 ? '+' : ''}{formatCommas(liveTotalProfitAmount)}원
                      </span>
                    </div>
                    <div className="border-t border-dashed border-slate-200 my-2" />
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">수익률:</span>
                      <span className={`font-mono font-bold ${
                        liveTotalProfitAmount > 0
                          ? 'text-rose-655'
                          : liveTotalProfitAmount < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {liveTotalProfitRate > 0 ? '+' : ''}{liveTotalProfitRate.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] pt-1">
                      <span className="text-slate-455 font-medium font-sans">미실현 손익 (보유):</span>
                      <span className={`font-mono font-bold ${
                        unrealizedProfit > 0
                          ? 'text-rose-655'
                          : unrealizedProfit < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {unrealizedProfit > 0 ? '+' : ''}{formatCommas(unrealizedProfit)}원
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-455 font-medium font-sans">실현 손익 (매도 누적):</span>
                      <span className={`font-mono font-bold ${
                        realizedProfitTotal > 0
                          ? 'text-rose-655'
                          : realizedProfitTotal < 0
                            ? 'text-blue-655'
                            : 'text-slate-600'
                      }`}>
                        {realizedProfitTotal > 0 ? '+' : ''}{formatCommas(realizedProfitTotal)}원
                      </span>
                    </div>
                  </div>
                </div>

                <div className="w-full mt-8 pt-6 border-t border-slate-100 space-y-4">
                  {/* Status displays */}
                  {successMsg && (
                    <div className="bg-emerald-50 border border-emerald-100/80 text-emerald-800 text-xs font-semibold rounded-xl p-4 flex items-start space-x-2 animate-fade-in">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="flex-1">{successMsg}</span>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs font-semibold rounded-xl p-4 flex items-start space-x-2 animate-fade-in">
                      <AlertTriangle className="w-4.5 h-4.5 text-rose-500 shrink-0 mt-0.5" />
                      <span className="flex-1">{errorMsg}</span>
                    </div>
                  )}

                  <button
                    id="save-portfolio-btn"
                    onClick={handleSavePortfolio}
                    disabled={isSaving || isCheckingRealPrices || isOverBudget}
                    className="w-full py-4 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl flex items-center justify-center space-x-2 cursor-pointer shadow-lg active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isSaving ? 'AI 실시간 시세 연계 및 저장 중...' : '포트폴리오 실시간 공유저장'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

          </div>

          <hr className="border-slate-200" />

          {/* Realtime Dashboard showing others portfolios list */}
          <div id="community-dashboard-card" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
            {isLoadingDb ? (
              <div className="text-center py-12 flex flex-col items-center space-y-2">
                <span className="w-6 h-6 border-2 border-emerald-650 border-t-transparent rounded-full animate-spin"></span>
                <p className="text-xs text-slate-400 font-bold">실시간 투자 랭킹 로딩 중...</p>
              </div>
            ) : (
              <ComparisonDashboard
                portfolios={rankedPortfolios}
                currentUserNickname={nickname}
                marketPrices={marketPrices}
                catalogPrices={catalogPrices}
                exchangeRate={effectiveExchangeRate}
              />
            )}
          </div>

        </main>
      </div>

      <footer className="bg-slate-900 px-6 sm:px-8 py-4 flex flex-col sm:flex-row justify-between items-center shrink-0 gap-4 mt-12 text-slate-400 select-none border-t border-slate-800">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 justify-center">
          <div className="flex flex-wrap gap-4 sm:gap-6 justify-center">
            <span className="text-[10px] flex items-center gap-2 font-mono"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> KOSPI {formatCommas(marketIndices.kospi)}</span>
            <span className="text-[10px] flex items-center gap-2 font-mono"><span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> S&P 500 {formatCommas(marketIndices.sp500)}</span>
            <span className="text-[10px] flex items-center gap-2 font-mono"><span className="w-1.5 h-1.5 bg-sky-500 rounded-full"></span> NASDAQ 100 {formatCommas(marketIndices.nasdaq)}</span>
            <span className="text-[10px] flex items-center gap-2 font-mono"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> USD/KRW {formatCommas(marketIndices.usdKrw)}</span>
          </div>
          {marketIndices.updatedAtLabel && (
            <span className="text-[9px] text-slate-500 font-mono">| 시세 기점: {marketIndices.updatedAtLabel}</span>
          )}
        </div>
        <div className="text-[10px] text-slate-500 font-medium font-mono">
          © 2026 INVEST10M • AI Real-time Market Analytics Connect
        </div>
      </footer>

      {showCustomAssetModal && nickname && (
        <CustomAssetModal
          nickname={nickname}
          onClose={() => setShowCustomAssetModal(false)}
          onSuccess={() => {
            setCustomAssetsVersion((v) => v + 1);
            setSuccessMsg('자산이 추가되었습니다 (AI 검증 완료)');
            setTimeout(() => setSuccessMsg(''), 4500);
            setShowCustomAssetModal(false);
          }}
        />
      )}

      {sellModalIndex != null && assets[sellModalIndex] && (
        <SellAssetModal
          asset={assets[sellModalIndex]}
          marketPrices={marketPrices}
          catalogPrices={catalogPrices}
          exchangeRate={effectiveExchangeRate}
          currentSavings={savings}
          isSubmitting={isSellSubmitting}
          onClose={() => setSellModalIndex(null)}
          onConfirm={handleConfirmSell}
        />
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-black text-slate-900' : 'font-bold text-slate-800'}`}>
        {value}
      </span>
    </div>
  );
}
