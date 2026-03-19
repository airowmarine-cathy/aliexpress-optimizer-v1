import React, { useState } from 'react';
import { Loader2, Lock, User as UserIcon } from 'lucide-react';
import { login } from './api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-800 font-sans flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center shadow-sm">
            <Lock className="text-white w-5 h-5" />
          </div>
          <div>
            <div className="text-[17px] font-semibold text-gray-900 tracking-tight">全球商品智能优化系统 V2.0</div>
            <div className="text-xs text-gray-500 mt-0.5">请使用管理员分配的账号密码登录</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">账号</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 bg-white">
              <UserIcon className="w-4 h-4 text-gray-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full text-sm outline-none"
                placeholder="例如 zhangsan"
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">密码</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 bg-white">
              <Lock className="w-4 h-4 text-gray-400" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full text-sm outline-none"
                placeholder="请输入密码"
                type="password"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</div>}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            登录
          </button>
        </form>
      </div>
    </div>
  );
}

