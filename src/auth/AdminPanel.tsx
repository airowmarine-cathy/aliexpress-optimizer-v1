import React, { useEffect, useMemo, useState } from 'react';
import { X, UserPlus, RefreshCw, Loader2, BarChart3, ClipboardList, TrendingUp, Users, Activity, DollarSign } from 'lucide-react';
import { adminAuditList, adminCreateUser, adminListUsers, adminResetPassword, adminTasksList, adminUsageDaily, adminUsageList, adminUsageSummary } from './api';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_STEPS: Array<{ key: string; label: string }> = [
  { key: 'factSheet',   label: '事实清单' },
  { key: 'seoTitle',    label: 'SEO 标题' },
  { key: 'marketing',   label: '黄金五点' },
  { key: 'attributes',  label: '属性清洗' },
  { key: 'description', label: '描述清洗' },
  { key: 'compliance',  label: '图片合规' },
  { key: 'remaster',    label: '首图重绘' },
];

const STEP_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500',
  'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
];
const MODEL_COLORS = [
  'bg-purple-500', 'bg-orange-500', 'bg-teal-500', 'bg-pink-500', 'bg-lime-500',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function abbrevModel(id: string): string {
  if (!id) return id;
  return id
    .replace('gemini-3-flash-preview', 'Gemini 3 Flash')
    .replace('gemini-2.5-flash-image', 'G2.5 Flash Image')
    .replace('gemini-2.0-flash-exp', 'Gemini 2.0 Flash')
    .replace('doubao-seed-2-0-pro-260215', 'Doubao Seed 2.0 Pro')
    .replace('doubao-seed-2-0-mini-260215', 'Doubao Seed 2.0 Mini')
    .replace('doubao-seed-2-0-lite-250115', 'Doubao Seed 2.0 Lite')
    .replace(/^deepseek-v3-\d+$/, 'DeepSeek V3')
    .replace(/^deepseek-r1-\d+$/, 'DeepSeek R1')
    .replace(/^deepseek-(.+)$/, (_m, s) => `DeepSeek ${s}`);
}

function fmtNum(v: string | number | null | undefined): string {
  if (v == null || v === '') return '0';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : String(v);
}

function fmtCost(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return `¥${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

function fmtTokenCompact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 flex items-start gap-3 shadow-sm">
      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-gray-500 font-medium truncate">{label}</div>
        <div className="text-xl font-bold text-gray-900 mt-0.5 leading-none truncate">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

/** Compact horizontal bar row — fixed widths to prevent overflow */
function HBarRow({
  label,
  value,
  max,
  colorClass = 'bg-indigo-500',
  cost,
  valueText,
}: {
  label: string;
  value: number;
  max: number;
  colorClass?: string;
  cost?: string | number | null;
  valueText?: string;
}) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 3;
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <span className="w-20 truncate flex-shrink-0 text-gray-700 font-medium" title={label}>{label}</span>
      <div className="flex-1 min-w-0 h-3.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right flex-shrink-0 text-gray-600 tabular-nums">{valueText ?? fmtTokenCompact(value)}</span>
      <span className="w-14 text-right flex-shrink-0 text-gray-400 tabular-nums">{fmtCost(cost)}</span>
    </div>
  );
}

/** SVG-based daily trend chart with y-axis + bar-line overlay */
function DailyTrendChart({
  data,
  metric,
}: {
  data: Array<{ date: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
  metric: 'calls' | 'tokens' | 'cost';
}) {
  if (!data.length) {
    return <div className="h-28 flex items-center justify-center text-xs text-gray-400">暂无数据</div>;
  }

  const values = data.map((d) => {
    if (metric === 'calls') return d.calls;
    if (metric === 'tokens') return d.input_tokens + d.output_tokens;
    return Number(d.cost_cny) || 0;
  });

  const maxVal = Math.max(...values, 1);
  const W = 640;
  const TOP = 10;
  const H = 96;
  const PAD_L = 42;
  const PAD_R = 8;
  const usableW = W - PAD_L - PAD_R;
  const step = usableW / data.length;
  const barW = Math.max(4, step - 3);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  const toY = (v: number) => TOP + (H - Math.max(2, Math.round((v / maxVal) * H)));
  const toX = (i: number) => PAD_L + i * step;

  // Points for line chart
  const pts = data.map((_, i) => [toX(i) + barW / 2, toY(values[i])] as [number, number]);
  const polylinePoints = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const areaPath =
    `M${pts[0][0]},${TOP + H} ` +
    pts.map(([x, y]) => `L${x},${y}`).join(' ') +
    ` L${pts[pts.length - 1][0]},${TOP + H} Z`;

  const yTicks = [1, 0.75, 0.5, 0.25, 0];
  const yLabel = (v: number) => {
    if (metric === 'cost') return fmtCost(v).replace('¥', '');
    if (metric === 'tokens') return fmtTokenCompact(v);
    return `${Math.round(v)}`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${TOP + H + 24}`} className="w-full" preserveAspectRatio="none">
      {/* Horizontal grid + y-axis labels */}
      {yTicks.map((f) => {
        const y = TOP + (H - f * H);
        const val = maxVal * f;
        return (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">
              {yLabel(val)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((_, i) => (
        <rect
          key={`bar-${i}`}
          x={toX(i)}
          y={toY(values[i])}
          width={barW}
            height={TOP + H - toY(values[i])}
          fill="#818cf8"
          rx={2}
          opacity={0.42}
        />
      ))}

      {/* Line overlay */}
      <path d={areaPath} fill="#6366f1" fillOpacity={0.06} />
      <polyline points={polylinePoints} fill="none" stroke="#4f46e5" strokeWidth={2.2} strokeLinejoin="round" />
      {data.map((_, i) => (
        <circle key={`dot-${i}`} cx={pts[i][0]} cy={pts[i][1]} r={2.8} fill="#4f46e5" stroke="white" strokeWidth={1.2} />
      ))}

      {/* Date labels */}
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text
            key={d.date}
            x={toX(i) + barW / 2}
            y={TOP + H + 16}
            fontSize={9}
            fill="#9ca3af"
            textAnchor="middle"
          >
            {d.date.slice(5)}
          </text>
        ) : null
      )}
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

  // Usage tab state
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
  const [userFilter, setUserFilter] = useState('');
  const [trendMetric, setTrendMetric] = useState<'calls' | 'tokens' | 'cost'>('calls');

  // Tasks tab state
  const [auditRecords, setAuditRecords] = useState<Array<any>>([]);
  const [taskRecords, setTaskRecords] = useState<Array<any>>([]);
  const [taskDays, setTaskDays] = useState<number | undefined>(undefined);
  const [taskUserFilter, setTaskUserFilter] = useState('');

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

  const refreshTasks = async (uid?: string, d?: number | undefined) => {
    setLoading(true);
    setError(null);
    const activeUserId = uid !== undefined ? uid : taskUserFilter;
    const activeDays = d !== undefined ? d : taskDays;
    try {
      const [audits, tasks] = await Promise.all([
        adminAuditList(100, activeUserId || undefined, activeDays),
        adminTasksList(100, activeUserId || undefined, activeDays),
      ]);
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

  const onTaskUserFilterChange = (uid: string) => {
    setTaskUserFilter(uid);
    void refreshTasks(uid, taskDays);
  };

  const onTaskDaysChange = (d: number | undefined) => {
    setTaskDays(d);
    void refreshTasks(taskUserFilter, d);
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

  const refreshByTab = () => {
    if (tab === 'users' || tab === 'create' || tab === 'reset') return refreshUsers();
    if (tab === 'usage') return refreshUsage();
    if (tab === 'tasks') return refreshTasks();
  };

  const TAB_LABELS: Record<typeof tab, string> = {
    users: '用户列表', create: '创建用户', reset: '重置密码', usage: '用量成本', tasks: '任务审计',
  };

  // Merge canonical steps with actual data (show all 7 even if 0)
  const stepDataMap = useMemo(() => {
    const m: Record<string, { tokens: number; cost_cny: string | number }> = {};
    for (const r of usageSummary?.byStep ?? []) {
      m[r.step] = { tokens: Number(r.input_tokens || 0) + Number(r.output_tokens || 0), cost_cny: r.cost_cny };
    }
    return m;
  }, [usageSummary]);

  const maxStepTokens = Math.max(...ALL_STEPS.map((s) => stepDataMap[s.key]?.tokens ?? 0), 1);
  const maxModelTokens = Math.max(...(usageSummary?.byModel.map((r) => Number(r.input_tokens || 0) + Number(r.output_tokens || 0)) ?? [1]), 1);
  const maxUserTokens = Math.max(...(usageSummary?.byUser.map((r) => Number(r.input_tokens || 0) + Number(r.output_tokens || 0)) ?? [1]), 1);

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-gray-50 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden border border-gray-200/50">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white rounded-t-3xl flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900">管理员后台</h3>
            <p className="text-xs text-gray-400 mt-0.5">用户管理 · 模型用量 · 任务与操作审计</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-1 bg-white/80 flex-shrink-0">
          {(['users', 'create', 'reset', 'usage', 'tasks'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                tab === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={refreshByTab}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">{error}</div>
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
                        <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50/60">
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
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                  placeholder="例如 zhangsan" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">初始密码（至少 10 位）</label>
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                  placeholder="例如 User@2026xxxx" type="password" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">角色</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <button type="submit" disabled={loading || !newUsername.trim() || newPassword.length < 10}
                className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
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
                <select value={resetUserId} onChange={(e) => setResetUserId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white">
                  {userOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">新密码（至少 10 位）</label>
                <input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 bg-white"
                  type="password" />
              </div>
              <button type="submit" disabled={loading || resetPassword.length < 10 || !resetUserId}
                className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-gray-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw size={16} />}
                重置密码
              </button>
            </form>
          )}

          {/* ── Usage & Cost ── */}
          {tab === 'usage' && (
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-200 px-4 py-3">
                <BarChart3 className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">统计周期</span>
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white">
                    <option value={7}>最近 7 天</option>
                    <option value={30}>最近 30 天</option>
                    <option value={90}>最近 90 天</option>
                  </select>
                </div>
                {users.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />用户
                    </span>
                    <select value={userFilter} onChange={(e) => onUserFilterChange(e.target.value)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white">
                      <option value="">全部用户</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
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
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <KpiCard label="总调用次数" value={fmtNum(usageSummary?.totals.total_calls)}
                      sub={`最近 ${days} 天`} icon={<Activity size={16} />} />
                    <KpiCard label="输入 Tokens" value={fmtNum(usageSummary?.totals.total_input_tokens)}
                      icon={<TrendingUp size={16} />} />
                    <KpiCard label="输出 Tokens" value={fmtNum(usageSummary?.totals.total_output_tokens)}
                      icon={<TrendingUp size={16} />} />
                    <KpiCard label="估算成本 (CNY)"
                      value={`¥ ${Number(usageSummary?.totals.total_cost_cny || 0).toFixed(2)}`}
                      icon={<DollarSign size={16} />} />
                  </div>

                  {/* Daily trend */}
                  {dailyData.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-indigo-500" />
                          每日趋势
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-1">
                            {([
                              ['calls',  '调用次数'],
                              ['tokens', 'Tokens'],
                              ['cost',   '费用'],
                            ] as const).map(([m, label]) => (
                              <button key={m} onClick={() => setTrendMetric(m)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                  trendMetric === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                                }`}>{label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <DailyTrendChart data={dailyData} metric={trendMetric} />
                    </div>
                  )}

                  {/* Distribution panels — 3 columns */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* By Step */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">按步骤分布</div>
                      <div className="grid grid-cols-[80px_1fr_56px_56px] gap-2 mb-2 text-[11px] text-gray-400 font-semibold">
                        <span>步骤</span><span></span><span className="text-right">Tokens</span><span className="text-right">花费</span>
                      </div>
                      {ALL_STEPS.map((s, i) => (
                        <HBarRow
                          key={s.key}
                          label={s.label}
                          value={stepDataMap[s.key]?.tokens ?? 0}
                          max={maxStepTokens}
                          colorClass={STEP_COLORS[i % STEP_COLORS.length]}
                          cost={stepDataMap[s.key]?.cost_cny}
                          valueText={fmtTokenCompact(stepDataMap[s.key]?.tokens ?? 0)}
                        />
                      ))}
                    </div>

                    {/* By Model */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">按模型分布</div>
                      <div className="grid grid-cols-[80px_1fr_56px_56px] gap-2 mb-2 text-[11px] text-gray-400 font-semibold">
                        <span>模型</span><span></span><span className="text-right">Tokens</span><span className="text-right">花费</span>
                      </div>
                      {(usageSummary?.byModel ?? []).length === 0 ? (
                        <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
                      ) : (
                        (usageSummary?.byModel ?? []).map((row, i) => (
                          <HBarRow
                            key={row.model_id}
                            label={abbrevModel(row.model_id)}
                            value={Number(row.input_tokens || 0) + Number(row.output_tokens || 0)}
                            max={maxModelTokens}
                            colorClass={MODEL_COLORS[i % MODEL_COLORS.length]}
                            cost={row.cost_cny}
                            valueText={fmtTokenCompact(Number(row.input_tokens || 0) + Number(row.output_tokens || 0))}
                          />
                        ))
                      )}
                    </div>

                    {/* By User */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">按用户分布</div>
                      <div className="grid grid-cols-[80px_1fr_56px_56px] gap-2 mb-2 text-[11px] text-gray-400 font-semibold">
                        <span>用户</span><span></span><span className="text-right">Tokens</span><span className="text-right">花费</span>
                      </div>
                      {(usageSummary?.byUser ?? []).length === 0 ? (
                        <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
                      ) : (
                        (usageSummary?.byUser ?? []).map((row) => (
                          <HBarRow
                            key={`${row.owner_user_id}`}
                            label={row.username}
                            value={Number(row.input_tokens || 0) + Number(row.output_tokens || 0)}
                            max={maxUserTokens}
                            colorClass="bg-emerald-500"
                            cost={row.cost_cny}
                            valueText={fmtTokenCompact(Number(row.input_tokens || 0) + Number(row.output_tokens || 0))}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Detail table */}
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
                            <th className="text-right px-4 py-2.5 whitespace-nowrap">输入 T</th>
                            <th className="text-right px-4 py-2.5 whitespace-nowrap">输出 T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageRecords.map((row) => (
                            <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                                {new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}
                              </td>
                              <td className="px-4 py-2 font-semibold text-gray-700">{row.username}</td>
                              <td className="px-4 py-2 text-gray-600">
                                {ALL_STEPS.find((s) => s.key === row.step)?.label ?? row.step}
                              </td>
                              <td className="px-4 py-2 text-gray-600 max-w-[140px] truncate" title={row.model_id}>
                                {abbrevModel(row.model_id)}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-gray-500 text-right">{fmtNum(row.input_tokens)}</td>
                              <td className="px-4 py-2 tabular-nums text-gray-500 text-right">{fmtNum(row.output_tokens)}</td>
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
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-200 px-4 py-3">
                <ClipboardList className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">日期范围</span>
                  <select
                    value={taskDays ?? ''}
                    onChange={(e) => onTaskDaysChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="">全部时间</option>
                    <option value={7}>最近 7 天</option>
                    <option value={30}>最近 30 天</option>
                    <option value={90}>最近 90 天</option>
                  </select>
                </div>
                {users.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />用户
                    </span>
                    <select value={taskUserFilter} onChange={(e) => onTaskUserFilterChange(e.target.value)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white">
                      <option value="">全部用户</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {loading && auditRecords.length === 0 && taskRecords.length === 0 ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 py-12 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </div>
              ) : (
                <>
                  {/* Task records */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-indigo-500" />
                      <span className="text-sm font-semibold text-gray-700">任务记录（上传 / 导出）</span>
                      <span className="ml-auto text-xs text-gray-400">{taskRecords.length} 条</span>
                    </div>
                    {taskRecords.length === 0 ? (
                      <div className="px-4 py-6 text-xs text-gray-400 text-center">
                        暂无记录（上传 / 导出操作完成后自动记录）
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left px-4 py-2.5 whitespace-nowrap">时间</th>
                            <th className="text-left px-4 py-2.5">用户</th>
                            <th className="text-left px-4 py-2.5">操作类型</th>
                            <th className="text-left px-4 py-2.5">文件名</th>
                            <th className="text-right px-4 py-2.5 whitespace-nowrap">产品数量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taskRecords.map((row) => {
                            const itemCount = row.total_items
                              || (row.details?.itemCount ?? 0);
                            return (
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
                                    {row.status === 'products.upload' ? '📤 上传' :
                                     row.status === 'products.export' ? '📥 导出' : row.status}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={row.filename}>
                                  {row.filename || '—'}
                                </td>
                                <td className="px-4 py-2 text-right font-semibold text-gray-700">
                                  {itemCount > 0 ? `${itemCount} 件` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Audit log */}
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
