import React, { useState } from 'react';
import { User, ArrowRight, Wrench } from 'lucide-react';

interface LoginModalProps {
  onLogin: (nickname: string) => Promise<void>;
  onEnterAdminMode: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLogin, onEnterAdminMode }) => {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await onLogin(nickname);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="login-modal" className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-xl rounded-2xl p-8 transition-all duration-300">
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100 shadow-sm mb-5 font-bold text-2xl font-sans select-none">
            ₩
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight font-sans text-center">
            Invest10M 모의 투자
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-2 text-center leading-relaxed">
            나만의 1,000만 원 자산 포트폴리오를 설계하고<br />
            실시간 실제 시세와 대조하여 전 세계 투자자들과 경쟁하세요.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 text-xs text-slate-500 leading-relaxed">
            <p className="font-semibold text-slate-700 mb-1">닉네임으로 입장</p>
            닉네임을 입력하면 기존 포트폴리오를 불러오거나, 새 포트폴리오를 생성합니다.
          </div>

          <div>
            <label htmlFor="nickname" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 font-mono">
              닉네임 (NICKNAME)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                <User className="w-4 h-4" />
              </span>
              <input
                id="nickname"
                type="text"
                placeholder="예: 홍길동, 투자왕 등"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (error) setError('');
                }}
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-slate-700 placeholder-slate-400 font-sans font-medium text-sm transition focus:outline-none focus:bg-white font-semibold"
              />
            </div>
            {error && (
              <p className="text-rose-500 text-xs font-semibold mt-2 ml-1">
                {error}
              </p>
            )}
          </div>

          <button
            id="nickname-submit-btn"
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold font-sans text-sm rounded-xl cursor-pointer shadow-lg hover:shadow-emerald-600/20 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center space-x-1.5"
          >
            <span>{isLoading ? '입장 중...' : '로그인'}</span>
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-slate-400 font-medium">또는</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onEnterAdminMode}
            disabled={isLoading}
            className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl border border-slate-200 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Wrench className="w-4 h-4" />
            관리자 모드
          </button>
        </form>
      </div>
    </div>
  );
};
