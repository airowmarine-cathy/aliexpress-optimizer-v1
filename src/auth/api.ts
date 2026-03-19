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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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

