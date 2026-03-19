import React, { useEffect, useMemo, useState } from 'react';
import { X, UserPlus, RefreshCw, Loader2, BarChart3, ClipboardList, TrendingUp, Users, Activity, DollarSign } from 'lucide-react';
import { adminAuditList, adminCreateUser, adminListUsers, adminResetPassword, adminTasksList, adminUsageDaily, adminUsageList, adminUsageSummary } from './api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function abbrevModel(id: string): string {
  return id
    .replace('gemini-3-flash-preview', 'Gemini 3 Flash')
    .replace('gemini-2.5-flash-image', 'Gemini 2.5 Flash Image')
    .replace('gemini-2.0-flash-exp', 'Gemini 2.0 Flash')
    .replace('doubao-seed-2-0-pro-260215', 'Doubao Seed 2.0 Pro')
    .replace('doubao-seed-2-0-mini-260215', 'Doubao Seed 2.0 Mini')
    .replace(/^deepseek-v3-\d+$/, 'DeepSeek V3')
    .replace(/^deepseek-(.+)$/, 'DeepSeek $1');
}

function abbrevStep(step: string): string {
  const map: Record<string, string> = {
    factSheet: '事实清单',
    seoTitle: 'SEO 标题',
    marketing: '黄金五点',
    attributes: '属性清洗',
    description: '描述清洗',
  };
  return map[step] ?? step;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 flex items-start gap-4 shadow-sm">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 flex-shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-xs text-gray-500 font-medium">{label}</div>
        <div className="text-2xl font-bold text-gray-900 mt-0.5 leading-none">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

function HBarRow({
  label,
  value,
  max,
  colorClass = 'bg-indigo-500',
  badge,
}: {
  label: string;
  value: number;
  max: number;
  colorClass?: string;
  badge?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-2 group">
      <div className="w-36 text-xs text-gray-700 truncate flex-shrink-0 font-medium" title={label}>
        {label}
      </div>
      <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-16 text-xs text-gray-600 text-right flex-shrink-0 tabular-nums">{value.toLocaleString()}</div>
      {badge !== undefined && (
        <div className="w-14 text-xs text-gray-400 text-right flex-shrink-0 tabular-nums">{badge}</div>
      )}
    </div>
  );
}

function DailyTrendChart({
  data,
  metric,
}: {
  data: Array<{ date: string; calls: number; input_tokens: number; output_tokens: number }>;
  metric: 'calls' | 'tokens';
}) {
  if (!data.length) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-gray-400">暂无数据</div>
    );
  }
  const values = data.map((d) => (metric === 'calls' ? d.calls : d.input_tokens + d.output_tokens));
  const maxVal = Math.max(...values, 1);
  const W = 600;
  const H = 100;
  const PAD_L = 4;
  const PAD_R = 4;
  const barW = Math.max(4, Math.floor((W - PAD_L - PAD_R) / data.length) - 2);
  const step = (W - PAD_L - PAD_R) / data.length;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" preserveAspectRatio="none">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map((frac) => (
        <line
          key={frac}
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - frac * H}
          y2={H - frac * H}
          stroke="#f3f4f6"
          strokeWidth={1}
        />
      ))}
      {/* Bars */}
      {data.map((d, i) => {
        const val = values[i];
        const barH = Math.max(2, Math.round((val / maxVal) * H));
        const x = PAD_L + i * step;
        return (
          <rect
            key={d.date}
            x={x}
            y={H - barH}
            width={barW}
            height={barH}
            fill="#6366f1"
            rx={2}
            opacity={0.75}
          />
        );
      })}
      {/* Date labels */}
      {data.map((d, i) => {
        if (i % labelEvery !== 0) return null;
        return (
          <text
            key={d.date}
            x={PAD_L + i * step + barW / 2}
            y={H + 15}
            fontSize={9}
            fill="#9ca3af"
            textAnchor="middle"
          >
            {d.date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'create' | 'reset' | 'usage' | 'tasks'>('users');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Users
  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string }>>([]);

  // Usage
  const [usageSummary, setUsageSummary] = useState<{
    days: number;
    totals: { total_calls: number; total_input_tokens: number; total_output_tokens: number; total_cost_cny: string | number };
    byStep: Array<{ step: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byModel: Array<{ model_id: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byUser: Array<{ owner_user_id: string | null; username: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
  } | null>(null);
  const [usageRecords, setUsageRecords] = useState<Array<any>>([]);
  const [dailyData, setDailyData] = useState<Array<{ date: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>>([]);
  const [days, setDays] = useState(30);
  const [userFilter, setUserFilter] = useState<string>('');
  const [trendMetric, setTrendMetric] = useState<'calls' | 'tokens'>('calls');

  // Tasks / Audit
  const [auditRecords, setAuditRecords] = useState<Array<any>>([]);
  const [taskRecords, setTaskRecords] = useState<Array<any>>([]);

  // Forms
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const userOptions = useMemo(
    () => users.map((u) => ({ id: u.id, label: `${u.username} (${u.role})` })),
    [users]
  );

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

  const refreshUsage = async (uid?: string) => {
    setLoading(true);
    setError(null);
    const activeUserId = uid !== undefined ? uid : userFilter;
    try {
      const [summary, list, daily] = await Promise.all([
        adminUsageSummary(days, activeUserId || undefined),
        adminUsageList(80, activeUserId || undefined),
        adminUsageDaily(days, activeUserId || undefined),
      ]);
      setUsageSummary(summary);
      setUsageRecords(list);
      setDailyData(daily);
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

  const onUserFilterChange = (uid: string) => {
    setUserFilter(uid);
    void refreshUsage(uid);
  };

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

  const fmt = (v: string | number | null | undefined) => {
    if (v == null || v === '') return '0';
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN') : String(v);
  };
  const fmtCost = (v: string | number | null | undefined) => {
    if (v == null || v === '') return '0.00';
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(n >= 1 ? 2 : 6) : String(v);
  };

  const refreshByTab = async () => {
    if (tab === 'users' || tab === 'create' || tab === 'reset') return refreshUsers();
    if (tab === 'usage') return refreshUsage();
    if (tab === 'tasks') return refreshTasks();
  };

  const TAB_LABELS: Record<typeof tab, string> = {
    users: '用户列表',
    create: '创建用户',
    reset: '重置密码',
    usage: '用量成本',
    tasks: '任务审计',
  };

  const maxStepCalls = Math.max(...(usageSummary?.byStep.map((r) => r.calls) ?? [1]), 1);
  const maxModelCalls = Math.max(...(usageSummary?.byModel.map((r) => r.calls) ?? [1]), 1);
  const maxUserCalls = Math.max(...(usageSummary?.byUser.map((r) => r.calls) ?? [1]), 1);

  const STEP_COLORS = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500'];
  const MODEL_COLORS = ['bg-rose-500', 'bg-orange-500', 'bg-teal-500', 'bg-cyan-500', 'bg-fuchsia-500'];

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-gray-50 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden border border-gray-200/50">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white rounded-t-3xl">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">管理员后台</h3>
            <p className="text-xs text-gray-400 mt-0.5">用户管理 · 模型用量 · 任务与操作审计</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-1 bg-white/80 backdrop-blur-sm">
          {(['users', 'create', 'reset', 'usage', 'tasks'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                tab === t
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={refreshByTab}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              {error}
            </div>
          )}

          {/* ── Users ── */}
          {tab === 'users' && (
            <div>
              {loading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </div>
              ) : users.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">暂无用户</div>
              ) : (
                <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">用户名</th>
                        <th className="text-left px-4 py-3">角色</th>
                        <th className="text-left px-4 py-3">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-900">{u.username}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                              u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {u.role === 'admin' ? '管理员' : '普通用户'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs">{u.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Create User ── */}
          {tab === 'create' && (
            <form onSubmit={onCreate} className="space-y-4 max-w-md">
              <div>
                <label className="text-xs font-semibold text-gray-600">用户名（拼音 / 工号）</label>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                  placeholder="例如 zhangsan"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">初始密码（至少 10 位）</label>
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
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
                className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
                创建用户
              </button>
            </form>
          )}

          {/* ── Reset Password ── */}
          {tab === 'reset' && (
            <form onSubmit={onReset} className="space-y-4 max-w-md">
              <div>
                <label className="text-xs font-semibold text-gray-600">选择用户</label>
                <select
                  value={resetUserId}
                  onChange={(e) => setResetUserId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                >
                  {userOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">新密码（至少 10 位）</label>
                <input
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                  type="password"
                />
              </div>
              <button
                type="submit"
                disabled={loading || resetPassword.length < 10 || !resetUserId}
                className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-gray-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw size={16} />}
                重置密码
              </button>
            </form>
          )}

          {/* ── Usage & Cost ── */}
          {tab === 'usage' && (
            <div className="space-y-5">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-200 px-4 py-3">
                <BarChart3 className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">统计周期</label>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value={7}>最近 7 天</option>
                    <option value={30}>最近 30 天</option>
                    <option value={90}>最近 90 天</option>
                  </select>
                </div>
                {users.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">
                      <Users className="w-3 h-3 inline mr-1" />用户筛选
                    </label>
                    <select
                      value={userFilter}
                      onChange={(e) => onUserFilterChange(e.target.value)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white"
                    >
                      <option value="">全部用户</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {loading && !usageSummary ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 py-12 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </div>
              ) : (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <KpiCard
                      label="总调用次数"
                      value={fmt(usageSummary?.totals.total_calls)}
                      sub={`最近 ${days} 天`}
                      icon={<Activity size={18} />}
                    />
                    <KpiCard
                      label="输入 Tokens"
                      value={fmt(usageSummary?.totals.total_input_tokens)}
                      icon={<TrendingUp size={18} />}
                    />
                    <KpiCard
                      label="输出 Tokens"
                      value={fmt(usageSummary?.totals.total_output_tokens)}
                      icon={<TrendingUp size={18} />}
                    />
                    <KpiCard
                      label="估算成本 (CNY)"
                      value={`¥ ${fmtCost(usageSummary?.totals.total_cost_cny)}`}
                      icon={<DollarSign size={18} />}
                    />
                  </div>

                  {/* Daily Trend Chart */}
                  {dailyData.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-indigo-500" />
                          每日趋势
                        </div>
                        <div className="flex gap-1">
                          {(['calls', 'tokens'] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => setTrendMetric(m)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                trendMetric === m
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-gray-500 hover:bg-gray-100'
                              }`}
                            >
                              {m === 'calls' ? '调用次数' : 'Tokens'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <DailyTrendChart data={dailyData} metric={trendMetric} />
                    </div>
                  )}

                  {/* 3-column bar chart section */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* By Step */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">按步骤分布</div>
                      {(usageSummary?.byStep || []).map((row, i) => (
                        <HBarRow
                          key={row.step}
                          label={abbrevStep(row.step)}
                          value={row.calls}
                          max={maxStepCalls}
                          colorClass={STEP_COLORS[i % STEP_COLORS.length]}
                        />
                      ))}
                    </div>

                    {/* By Model */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">按模型分布</div>
                      {(usageSummary?.byModel || []).map((row, i) => (
                        <HBarRow
                          key={row.model_id}
                          label={abbrevModel(row.model_id)}
                          value={row.calls}
                          max={maxModelCalls}
                          colorClass={MODEL_COLORS[i % MODEL_COLORS.length]}
                          badge={`¥${fmtCost(row.cost_cny)}`}
                        />
                      ))}
                    </div>

                    {/* By User */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">按用户分布</div>
                      {(usageSummary?.byUser || []).map((row) => (
                        <HBarRow
                          key={`${row.owner_user_id}`}
                          label={row.username}
                          value={row.calls}
                          max={maxUserCalls}
                          colorClass="bg-emerald-500"
                          badge={`¥${fmtCost(row.cost_cny)}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Detail Table */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
                      最近调用明细
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2.5 whitespace-nowrap">时间</th>
                            <th className="text-left px-4 py-2.5">用户</th>
                            <th className="text-left px-4 py-2.5">步骤</th>
                            <th className="text-left px-4 py-2.5">模型</th>
                            <th className="text-left px-4 py-2.5 whitespace-nowrap">输入 T</th>
                            <th className="text-left px-4 py-2.5 whitespace-nowrap">输出 T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageRecords.map((row) => (
                            <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                                {new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}
                              </td>
                              <td className="px-4 py-2 font-semibold text-gray-700">{row.username}</td>
                              <td className="px-4 py-2 text-gray-600">{abbrevStep(row.step)}</td>
                              <td className="px-4 py-2 text-gray-600 max-w-[160px] truncate" title={row.model_id}>
                                {abbrevModel(row.model_id)}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-gray-500">{fmt(row.input_tokens)}</td>
                              <td className="px-4 py-2 tabular-nums text-gray-500">{fmt(row.output_tokens)}</td>
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

          {/* ── Tasks / Audit ── */}
          {tab === 'tasks' && (
            <div className="space-y-5">
              {loading && auditRecords.length === 0 && taskRecords.length === 0 ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 py-12 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </div>
              ) : (
                <>
                  {/* Task Records */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-indigo-500" />
                      <span className="text-sm font-semibold text-gray-700">任务记录（上传 / 导出 / 作业）</span>
                      <span className="ml-auto text-xs text-gray-400">{taskRecords.length} 条</span>
                    </div>
                    {taskRecords.length === 0 ? (
                      <div className="px-4 py-6 text-xs text-gray-400 text-center">暂无任务记录</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2.5 whitespace-nowrap">时间</th>
                            <th className="text-left px-4 py-2.5">用户</th>
                            <th className="text-left px-4 py-2.5">类型</th>
                            <th className="text-left px-4 py-2.5">文件名</th>
                            <th className="text-left px-4 py-2.5">数量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taskRecords.map((row) => (
                            <tr key={`${row.source}-${row.id}`} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                                {new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}
                              </td>
                              <td className="px-4 py-2 font-semibold text-gray-700">{row.username}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                                  row.status === 'products.upload' ? 'bg-blue-50 text-blue-600' :
                                  row.status === 'products.export' ? 'bg-green-50 text-green-600' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {row.status === 'products.upload' ? '上传' :
                                   row.status === 'products.export' ? '导出' : row.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={row.filename}>
                                {row.filename || '-'}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-gray-500">
                                {row.total_items > 0 ? `${row.total_items} 件` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Audit Log */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-semibold text-gray-700">操作审计日志</span>
                      <span className="ml-auto text-xs text-gray-400">{auditRecords.length} 条</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="text-left px-4 py-2.5 whitespace-nowrap">时间</th>
                          <th className="text-left px-4 py-2.5">用户</th>
                          <th className="text-left px-4 py-2.5">动作</th>
                          <th className="text-left px-4 py-2.5">详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRecords.map((row) => (
                          <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/50 align-top">
                            <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                              {new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}
                            </td>
                            <td className="px-4 py-2 font-semibold text-gray-700">{row.username}</td>
                            <td className="px-4 py-2">
                              <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 font-mono">
                                {row.action}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-gray-400 font-mono max-w-xs truncate" title={JSON.stringify(row.details)}>
                              {row.details ? JSON.stringify(row.details) : '—'}
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
