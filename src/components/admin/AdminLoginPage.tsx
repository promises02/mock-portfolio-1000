import React, { useState } from 'react';
import { Wrench, ArrowLeft, Loader2 } from 'lucide-react';
import { verifyAdminPassword } from '../../firebase';

interface AdminLoginPageProps {
  onSuccess: (password: string) => void;
  onBack: () => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onSuccess, onBack }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    if (verifyAdminPassword(password)) {
      onSuccess(password.trim());
    } else {
      setError('비밀번호가 틀렸습니다');
    }
    setIsSubmitting(false);
  };

  return (
    <div
      className="flex items-center justify-center min-h-[60vh] px-4"
      data-logical-name="newAdminModeAssetPriceEditor"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-xl rounded-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100 mb-4">
            <Wrench className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800">관리자 모드</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              autoFocus
              disabled={isSubmitting}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl text-slate-800 outline-none transition"
              placeholder="비밀번호 입력"
            />
            {error && (
              <p className="text-rose-500 text-xs font-semibold mt-2">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !password.trim()}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                확인 중...
              </>
            ) : (
              '확인'
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={onBack}
          className="w-full mt-4 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition cursor-pointer flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로 (일반 로그인)
        </button>
      </div>
    </div>
  );
};
