import React, { useEffect, useMemo, useState } from 'react';
import { X, UserPlus, RefreshCw, Loader2 } from 'lucide-react';
import { adminCreateUser, adminListUsers, adminResetPassword } from './api';

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'create' | 'reset'>('users');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string }>>([]);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: `${u.username} (${u.role})` })), [users]);

  const refreshUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminListUsers();
      setUsers(list);
      if (!resetUserId && list.length > 0) setResetUserId(list[0].id);
    } catch (e: any) {
      setError(e?.message || '加载用户失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminCreateUser({ username: newUsername.trim(), password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setTab('users');
      await refreshUsers();
    } catch (e: any) {
      setError(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminResetPassword(resetUserId, resetPassword);
      setResetPassword('');
      setTab('users');
      await refreshUsers();
    } catch (e: any) {
      setError(e?.message || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-sm">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 tracking-tight">管理员后台</h3>
            <p className="text-sm text-gray-500 mt-1">创建账号、重置密码（用户忘记密码时用）</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50/40">
          {(['users', 'create', 'reset'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-white border border-gray-200 shadow-sm' : 'text-gray-600 hover:bg-white/60'
              }`}
            >
              {t === 'users' ? '用户列表' : t === 'create' ? '创建用户' : '重置密码'}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={refreshUsers}
            className="px-3 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 flex items-center gap-2"
            disabled={loading}
          >
            <RefreshCw size={16} /> 刷新
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">{error}</div>}

          {tab === 'users' && (
            <div className="space-y-3">
              {loading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
                </div>
              ) : users.length === 0 ? (
                <div className="text-sm text-gray-500">暂无用户</div>
              ) : (
                <div className="border border-gray-100 rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold">用户名</th>
                        <th className="text-left px-4 py-3 font-semibold">角色</th>
                        <th className="text-left px-4 py-3 font-semibold">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-900">{u.username}</td>
                          <td className="px-4 py-3 text-gray-700">{u.role}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{u.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'create' && (
            <form onSubmit={onCreate} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600">用户名（拼音/工号）</label>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                  placeholder="例如 zhangsan"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">初始密码（至少 10 位）</label>
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                  placeholder="例如 User@2026xxxx"
                  type="password"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">角色</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={loading || !newUsername.trim() || newPassword.length < 10}
                className="px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={18} />}
                创建用户
              </button>
            </form>
          )}

          {tab === 'reset' && (
            <form onSubmit={onReset} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600">选择用户</label>
                <select
                  value={resetUserId}
                  onChange={(e) => setResetUserId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                >
                  {userOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">新密码（至少 10 位）</label>
                <input
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                  type="password"
                />
              </div>
              <button
                type="submit"
                disabled={loading || resetPassword.length < 10 || !resetUserId}
                className="px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw size={18} />}
                重置密码
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

