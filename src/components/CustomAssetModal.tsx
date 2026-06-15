import React, { useMemo, useState } from 'react';
import { X, Plus, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { addCustomAsset, addAdminCustomAsset, validateAsset } from '../firebase';
import {
  AssetMarket,
  CustomAsset,
  DisplayCurrency,
  MarketSegment,
  SECTOR_OPTIONS,
  SectorOption,
  ValidationResult,
} from '../types';
import { getDefaultDisplayCurrency } from '../utils';

interface CustomAssetModalProps {
  nickname: string;
  onClose: () => void;
  onSuccess: (asset: CustomAsset) => void;
  mode?: 'user' | 'admin';
}

interface MarketSegmentOption {
  value: MarketSegment;
  label: string;
  marketRegion: AssetMarket;
  type: CustomAsset['type'];
  marketLabel: string;
}

const MARKET_SEGMENTS: MarketSegmentOption[] = [
  { value: 'us_stock', label: '미국 주식', marketRegion: 'US', type: 'stock', marketLabel: '미국 주식' },
  { value: 'kr_stock', label: '한국 주식', marketRegion: 'Korea', type: 'stock', marketLabel: '한국 주식' },
  { value: 'us_etf', label: '미국 ETF', marketRegion: 'US', type: 'etf', marketLabel: '미국 ETF' },
  { value: 'kr_etf', label: '한국 ETF', marketRegion: 'Korea', type: 'etf', marketLabel: '한국 ETF' },
  { value: 'crypto', label: '암호화폐', marketRegion: 'Crypto', type: 'crypto', marketLabel: '암호화폐' },
];

type DisplayCurrencyChoice = 'default' | DisplayCurrency;

const DISPLAY_CURRENCY_OPTIONS: { value: DisplayCurrencyChoice; label: string }[] = [
  { value: 'default', label: '기본값' },
  { value: 'USD', label: 'USD' },
  { value: 'KRW', label: 'KRW' },
];

export const CustomAssetModal: React.FC<CustomAssetModalProps> = ({
  nickname,
  onClose,
  onSuccess,
  mode = 'user',
}) => {
  const isAdminMode = mode === 'admin';
  const [assetName, setAssetName] = useState('');
  const [price, setPrice] = useState('');
  const [marketSegment, setMarketSegment] = useState<MarketSegment>('kr_stock');
  const [displayCurrencyChoice, setDisplayCurrencyChoice] = useState<DisplayCurrencyChoice>('default');
  const [ticker, setTicker] = useState('');
  const [sector, setSector] = useState<SectorOption>(SECTOR_OPTIONS[0]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);

  const segment = useMemo(
    () => MARKET_SEGMENTS.find((s) => s.value === marketSegment) ?? MARKET_SEGMENTS[1],
    [marketSegment]
  );

  const resolvedDefaultCurrency = useMemo(
    () => getDefaultDisplayCurrency(segment.marketRegion),
    [segment.marketRegion]
  );

  const effectiveDisplayCurrency: DisplayCurrency =
    displayCurrencyChoice === 'default' ? resolvedDefaultCurrency : displayCurrencyChoice;

  const defaultCurrencyLabel =
    resolvedDefaultCurrency === 'CRYPTO' ? 'CRYPTO' : resolvedDefaultCurrency;

  const pricePlaceholder =
    effectiveDisplayCurrency === 'USD'
      ? '981.61'
      : effectiveDisplayCurrency === 'CRYPTO'
        ? '0.0532'
        : '322500';

  const validateForm = (): boolean => {
    setError('');
    const trimmedName = assetName.trim();
    const parsedPrice = parseFloat(price);

    if (!trimmedName) {
      setError('자산명을 입력해주세요.');
      return false;
    }
    if (!price.trim() || Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('올바른 가격을 입력해주세요.');
      return false;
    }
    return true;
  };

  const saveAsset = async (result?: ValidationResult | null) => {
    const trimmedName = assetName.trim();
    const parsedPrice = parseFloat(price);
    const resolvedTicker = ticker.trim() || result?.ticker || undefined;
    const resolvedSector = sector;
    const isVerified = result?.isValid === true && !result?.apiError;
    const verificationStatus = result
      ? result.apiError
        ? 'api_error_skipped'
        : result.isValid
          ? 'verified'
          : 'unverified'
      : undefined;

    setIsSubmitting(true);
    try {
      if (isAdminMode) {
        const adminResult = await addAdminCustomAsset({
          assetName: trimmedName,
          type: segment.type,
          inputPrice: effectiveDisplayCurrency === 'CRYPTO' ? price.trim() : parsedPrice,
          displayCurrency: effectiveDisplayCurrency,
          ticker: resolvedTicker,
          sector: resolvedSector,
          market: segment.marketLabel,
          sourceUrl: sourceUrl || undefined,
          marketRegion: segment.marketRegion,
        });
        if (!adminResult.success || !adminResult.asset) {
          setError(adminResult.message || '상품 추가 중 오류가 발생했습니다.');
          return;
        }
        onSuccess(adminResult.asset);
        return;
      }

      const created = await addCustomAsset(
        nickname,
        trimmedName,
        segment.type,
        effectiveDisplayCurrency === 'CRYPTO' ? price.trim() : parsedPrice,
        effectiveDisplayCurrency,
        resolvedTicker,
        resolvedSector,
        segment.marketLabel,
        sourceUrl || undefined,
        segment.marketRegion,
        isVerified,
        verificationStatus
      );
      onSuccess(created);
    } catch (err) {
      console.error(err);
      setError('자산 추가 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
      setShowValidationDialog(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (isAdminMode) {
      await saveAsset(null);
      return;
    }

    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await validateAsset(
        assetName.trim(),
        segment.marketLabel,
        price.trim()
      );
      setValidationResult(result);
      setShowValidationDialog(true);
    } catch (err) {
      console.error(err);
      setValidationResult({
        isValid: false,
        assetName: assetName.trim(),
        confidence: 0,
        message: '검증 실패. 계속 진행하시겠어요?',
        apiError: true,
      });
      setShowValidationDialog(true);
    } finally {
      setIsValidating(false);
    }
  };

  const handleCloseValidation = () => {
    setShowValidationDialog(false);
    setValidationResult(null);
  };

  const isBusy = isValidating || isSubmitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      data-logical-name="customAssetManagement"
    >
      <div
        className={`w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden ${
          isAdminMode ? 'ring-2 ring-indigo-100' : ''
        }`}
        data-logical-name={isAdminMode ? 'adminAddAsset' : 'assetAdditionUIImprovement'}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b border-slate-100 ${
            isAdminMode ? 'bg-indigo-50/80' : 'bg-emerald-50/50'
          }`}
        >
          <div>
            <h3 className="text-base font-extrabold text-slate-800">
              {isAdminMode ? '관리자 상품 추가' : '자산 직접 추가'}
            </h3>
            {isAdminMode && (
              <p className="text-[10px] text-indigo-600 font-medium mt-0.5">
                추가한 상품은 모든 참여자에게 공통으로 표시됩니다
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              자산명 *
            </label>
            <input
              type="text"
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
              placeholder="예: 삼성전자, TSLA"
              disabled={isBusy}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-sm outline-none transition disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                시장 구분 *
              </label>
              <select
                value={marketSegment}
                onChange={(e) => setMarketSegment(e.target.value as MarketSegment)}
                disabled={isBusy}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-sm outline-none transition cursor-pointer disabled:opacity-60"
              >
                {MARKET_SEGMENTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                가격 *
              </label>
              <input
                type="number"
                min="0"
                step={effectiveDisplayCurrency === 'KRW' ? '1' : 'any'}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={pricePlaceholder}
                disabled={isBusy}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-sm font-mono outline-none transition disabled:opacity-60"
              />
            </div>
          </div>

          <div
            className="grid grid-cols-1 gap-3"
            data-logical-name="displayCurrencySelection"
          >
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                가격 표시 통화
              </label>
              <select
                value={displayCurrencyChoice}
                onChange={(e) => setDisplayCurrencyChoice(e.target.value as DisplayCurrencyChoice)}
                disabled={isBusy}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-sm outline-none transition cursor-pointer disabled:opacity-60"
              >
                {DISPLAY_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === 'default'
                      ? `기본값 (${defaultCurrencyLabel})`
                      : option.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                입력한 가격은 {effectiveDisplayCurrency} 단위로 저장됩니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                티커 (선택)
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="AAPL"
                disabled={isBusy}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-sm outline-none transition disabled:opacity-60"
              />
            </div>
            <div data-logical-name="sectorDropdownSelection">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                섹터 *
              </label>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value as SectorOption)}
                disabled={isBusy}
                required
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-sm outline-none transition cursor-pointer disabled:opacity-60"
              >
                {SECTOR_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              참고 링크 (선택)
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              disabled={isBusy}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-sm outline-none transition disabled:opacity-60"
            />
          </div>

          {error && (
            <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className={`flex-1 py-2.5 text-white text-sm font-bold rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                isAdminMode
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  검증 중...
                </>
              ) : isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isAdminMode ? '추가 중...' : '저장 중...'}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  {isAdminMode ? '상품 추가' : '추가'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {showValidationDialog && validationResult && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          data-logical-name="assetValidationWithGemini"
        >
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div
              className={`px-6 py-4 border-b ${
                validationResult.apiError
                  ? 'bg-amber-50/80 border-amber-100'
                  : validationResult.isValid
                    ? 'bg-emerald-50/80 border-emerald-100'
                    : 'bg-rose-50/80 border-rose-100'
              }`}
            >
              <div className="flex items-center gap-2">
                {validationResult.apiError ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                ) : validationResult.isValid ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                )}
                <h4 className="text-sm font-extrabold text-slate-800">
                  {validationResult.apiError
                    ? '검증 실패'
                    : validationResult.isValid
                      ? '자산 검증 완료'
                      : '자산 검증 실패'}
                </h4>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                {validationResult.apiError
                  ? validationResult.message
                  : validationResult.isValid
                    ? `✅ ${validationResult.message}`
                    : `❌ ${validationResult.message || '입력하신 정보를 확인해주세요.'}`}
              </p>

              {!validationResult.apiError && validationResult.isValid && (
                <div className="text-xs text-slate-500 space-y-1 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  {validationResult.ticker && (
                    <p>
                      <span className="font-bold text-slate-600">Ticker:</span>{' '}
                      {validationResult.ticker}
                    </p>
                  )}
                  {validationResult.sector && (
                    <p>
                      <span className="font-bold text-slate-600">업종:</span>{' '}
                      {validationResult.sector}
                    </p>
                  )}
                  <p>
                    <span className="font-bold text-slate-600">신뢰도:</span>{' '}
                    {validationResult.confidence}%
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCloseValidation}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                >
                  {validationResult.apiError ? '취소' : '수정'}
                </button>
                <button
                  type="button"
                  onClick={() => saveAsset(validationResult)}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      저장 중...
                    </>
                  ) : validationResult.apiError ? (
                    '계속 저장'
                  ) : (
                    '저장'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
