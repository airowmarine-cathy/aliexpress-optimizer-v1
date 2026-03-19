import React, { useEffect, useMemo, useState } from 'react';
import { X, UserPlus, RefreshCw, Loader2, BarChart3, ClipboardList } from 'lucide-react';
import { adminAuditList, adminCreateUser, adminListUsers, adminResetPassword, adminTasksList, adminUsageList, adminUsageSummary } from './api';

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'create' | 'reset' | 'usage' | 'tasks'>('users');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string }>>([]);
  const [usageSummary, setUsageSummary] = useState<{
    days: number;
    totals: { total_calls: number; total_input_tokens: number; total_output_tokens: number; total_cost_cny: string | number };
    byStep: Array<{ step: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byModel: Array<{ model_id: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byUser: Array<{ owner_user_id: string | null; username: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
  } | null>(null);
  const [usageRecords, setUsageRecords] = useState<Array<any>>([]);
  const [auditRecords, setAuditRecords] = useState<Array<any>>([]);
  const [taskRecords, setTaskRecords] = useState<Array<any>>([]);
  const [days, setDays] = useState(30);

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

  const refreshUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, list] = await Promise.all([adminUsageSummary(days), adminUsageList(80)]);
      setUsageSummary(summary);
      setUsageRecords(list);
    } catch (e: any) {
      setError(e?.message || '加载用量失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const [audits, tasks] = await Promise.all([adminAuditList(100), adminTasksList(100)]);
      setAuditRecords(audits);
      setTaskRecords(tasks);
    } catch (e: any) {
      setError(e?.message || '加载审计失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'usage') void refreshUsage();
    if (tab === 'tasks') void refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days]);

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

  const formatNumber = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return '0';
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('zh-CN') : String(value);
  };

  const formatCost = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return '0.000000';
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(6) : String(value);
  };

  const refreshByTab = async () => {
    if (tab === 'users' || tab === 'create' || tab === 'reset') return refreshUsers();
    if (tab === 'usage') return refreshUsage();
    if (tab === 'tasks') return refreshTasks();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-sm">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 tracking-tight">管理员后台</h3>
            <p className="text-sm text-gray-500 mt-1">用户管理、模型用量、任务与操作审计</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50/40">
          {(['users', 'create', 'reset', 'usage', 'tasks'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-white border border-gray-200 shadow-sm' : 'text-gray-600 hover:bg-white/60'
              }`}
            >
              {t === 'users'
                ? '用户列表'
                : t === 'create'
                  ? '创建用户'
                  : t === 'reset'
                    ? '重置密码'
                    : t === 'usage'
                      ? '用量成本'
                      : '任务审计'}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={refreshByTab}
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

          {tab === 'usage' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-semibold text-gray-700">统计周期</span>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
                >
                  <option value={7}>最近 7 天</option>
                  <option value={30}>最近 30 天</option>
                  <option value={90}>最近 90 天</option>
                </select>
              </div>

              {loading && !usageSummary ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-xs text-gray-500">总调用次数</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-2">{formatNumber(usageSummary?.totals.total_calls)}</div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-xs text-gray-500">输入 Tokens</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-2">{formatNumber(usageSummary?.totals.total_input_tokens)}</div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-xs text-gray-500">输出 Tokens</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-2">{formatNumber(usageSummary?.totals.total_output_tokens)}</div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-xs text-gray-500">估算成本 (CNY)</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-2">{formatCost(usageSummary?.totals.total_cost_cny)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700">按步骤汇总</div>
                      <table className="w-full text-sm">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2">步骤</th>
                            <th className="text-left px-4 py-2">调用</th>
                            <th className="text-left px-4 py-2">成本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(usageSummary?.byStep || []).map((row) => (
                            <tr key={row.step} className="border-t border-gray-100">
                              <td className="px-4 py-2">{row.step}</td>
                              <td className="px-4 py-2">{formatNumber(row.calls)}</td>
                              <td className="px-4 py-2">{formatCost(row.cost_cny)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-2xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700">按模型汇总</div>
                      <table className="w-full text-sm">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2">模型</th>
                            <th className="text-left px-4 py-2">调用</th>
                            <th className="text-left px-4 py-2">成本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(usageSummary?.byModel || []).map((row) => (
                            <tr key={row.model_id} className="border-t border-gray-100">
                              <td className="px-4 py-2 break-all">{row.model_id}</td>
                              <td className="px-4 py-2">{formatNumber(row.calls)}</td>
                              <td className="px-4 py-2">{formatCost(row.cost_cny)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-2xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700">按用户汇总</div>
                      <table className="w-full text-sm">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2">用户</th>
                            <th className="text-left px-4 py-2">调用</th>
                            <th className="text-left px-4 py-2">成本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(usageSummary?.byUser || []).map((row) => (
                            <tr key={`${row.owner_user_id}-${row.username}`} className="border-t border-gray-100">
                              <td className="px-4 py-2">{row.username}</td>
                              <td className="px-4 py-2">{formatNumber(row.calls)}</td>
                              <td className="px-4 py-2">{formatCost(row.cost_cny)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700">最近调用明细</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2">时间</th>
                            <th className="text-left px-4 py-2">用户</th>
                            <th className="text-left px-4 py-2">步骤</th>
                            <th className="text-left px-4 py-2">模型</th>
                            <th className="text-left px-4 py-2">Tokens</th>
                            <th className="text-left px-4 py-2">元数据</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageRecords.map((row) => (
                            <tr key={row.id} className="border-t border-gray-100 align-top">
                              <td className="px-4 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                              <td className="px-4 py-2">{row.username}</td>
                              <td className="px-4 py-2">{row.step}</td>
                              <td className="px-4 py-2 break-all">{row.model_id}</td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                in {formatNumber(row.input_tokens)} / out {formatNumber(row.output_tokens)}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-gray-500 max-w-[280px] break-all">
                                {row.meta ? JSON.stringify(row.meta) : '{}'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="space-y-6">
              {loading && auditRecords.length === 0 && taskRecords.length === 0 ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-indigo-500" /> 任务记录（上传/导出/作业）
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left px-4 py-2">时间</th>
                          <th className="text-left px-4 py-2">用户</th>
                          <th className="text-left px-4 py-2">类型</th>
                          <th className="text-left px-4 py-2">文件名</th>
                          <th className="text-left px-4 py-2">数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskRecords.map((row) => (
                          <tr key={`${row.source}-${row.id}`} className="border-t border-gray-100">
                            <td className="px-4 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                            <td className="px-4 py-2">{row.username}</td>
                            <td className="px-4 py-2">{row.status}</td>
                            <td className="px-4 py-2 break-all">{row.filename || '-'}</td>
                            <td className="px-4 py-2">{formatNumber(row.total_items)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-2xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700">操作审计</div>
                    <table className="w-full text-sm">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left px-4 py-2">时间</th>
                          <th className="text-left px-4 py-2">用户</th>
                          <th className="text-left px-4 py-2">动作</th>
                          <th className="text-left px-4 py-2">详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRecords.map((row) => (
                          <tr key={row.id} className="border-t border-gray-100 align-top">
                            <td className="px-4 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                            <td className="px-4 py-2">{row.username}</td>
                            <td className="px-4 py-2">{row.action}</td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-500 max-w-[420px] break-all">
                              {row.details ? JSON.stringify(row.details) : '{}'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

