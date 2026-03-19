export type User = {
  id: string;
  username: string;
  role: 'admin' | 'user';
};

const TOKEN_KEY = 'ali_opt_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function login(username: string, password: string) {
  const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(data.token);
  return data.user;
}

export async function me() {
  const data = await apiFetch<{ user: User }>('/api/auth/me');
  return data.user;
}

export async function adminListUsers() {
  const data = await apiFetch<{ users: Array<User & { created_at: string; updated_at: string }> }>(
    '/api/admin/users'
  );
  return data.users;
}

export async function adminCreateUser(payload: { username: string; password: string; role?: 'admin' | 'user' }) {
  const data = await apiFetch<{ user: User & { created_at: string } }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return data.user;
}

export async function adminResetPassword(userId: string, newPassword: string) {
  const data = await apiFetch<{ ok: true }>(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword })
  });
  return data.ok;
}

export async function auditClientEvent(action: string, details?: Record<string, any>) {
  const data = await apiFetch<{ ok: true }>('/api/audit/client-event', {
    method: 'POST',
    body: JSON.stringify({ action, details })
  });
  return data.ok;
}

export async function adminUsageSummary(days = 30, userId?: string) {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  return await apiFetch<{
    days: number;
    totals: {
      total_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_cny: string | number;
    };
    byStep: Array<{ step: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byModel: Array<{ model_id: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
    byUser: Array<{ owner_user_id: string | null; username: string; calls: number; input_tokens: number; output_tokens: number; cost_cny: string | number }>;
  }>(`/api/admin/usage/summary?${params}`);
}

export async function adminUsageList(limit = 100, userId?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (userId) params.set('userId', userId);
  const data = await apiFetch<{
    records: Array<{
      id: string;
      created_at: string;
      step: string;
      provider: string;
      model_id: string;
      input_tokens: number | null;
      output_tokens: number | null;
      cost_cny: string | number | null;
      meta: any;
      owner_user_id: string | null;
      username: string;
    }>;
  }>(`/api/admin/usage/list?${params}`);
  return data.records;
}

export async function adminUsageDaily(days = 30, userId?: string) {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const data = await apiFetch<{
    records: Array<{
      date: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_cny: string | number;
    }>;
  }>(`/api/admin/usage/daily?${params}`);
  return data.records;
}

export async function adminAuditList(limit = 100, userId?: string, days?: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (userId) params.set('userId', userId);
  if (days) params.set('days', String(days));
  const data = await apiFetch<{
    records: Array<{
      id: string;
      action: string;
      details: any;
      created_at: string;
      actor_user_id: string | null;
      username: string;
    }>;
  }>(`/api/admin/audit/list?${params}`);
  return data.records;
}

export async function adminTasksList(limit = 100, userId?: string, days?: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (userId) params.set('userId', userId);
  if (days) params.set('days', String(days));
  const data = await apiFetch<{
    records: Array<{
      id: string;
      source: 'job' | 'event';
      status: string;
      filename: string;
      total_items: number;
      created_at: string;
      updated_at: string;
      owner_user_id: string | null;
      username: string;
      details?: any;
    }>;
  }>(`/api/admin/tasks/list?${params}`);
  return data.records;
}

export async function taskCreate(payload: {
  filename?: string;
  totalItems: number;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload?: Record<string, any>;
}) {
  const data = await apiFetch<{
    task: {
      id: string;
      owner_user_id: string;
      job_id: string | null;
      filename: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      total_items: number;
      completed_items: number;
      failed_items: number;
      payload: any;
      created_at: string;
      updated_at: string;
    };
  }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return data.task;
}

export async function taskList(limit = 30) {
  const data = await apiFetch<{
    tasks: Array<{
      id: string;
      owner_user_id: string;
      job_id: string | null;
      filename: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      total_items: number;
      completed_items: number;
      failed_items: number;
      payload: any;
      created_at: string;
      updated_at: string;
    }>;
  }>(`/api/tasks/list?limit=${limit}`);
  return data.tasks;
}

export async function taskGet(taskId: string) {
  const data = await apiFetch<{
    task: {
      id: string;
      owner_user_id: string;
      job_id: string | null;
      filename: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      total_items: number;
      completed_items: number;
      failed_items: number;
      payload: any;
      created_at: string;
      updated_at: string;
    };
  }>(`/api/tasks/${taskId}`);
  return data.task;
}

export async function taskUpdate(taskId: string, payload: {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  completedItems?: number;
  failedItems?: number;
  payload?: Record<string, any>;
}) {
  const data = await apiFetch<{
    task: {
      id: string;
      owner_user_id: string;
      job_id: string | null;
      filename: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      total_items: number;
      completed_items: number;
      failed_items: number;
      payload: any;
      created_at: string;
      updated_at: string;
    };
  }>(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  return data.task;
}

