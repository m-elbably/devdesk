import type { SyncOperation, PushResult, PullResponse } from '@devdesk/shared'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  active: boolean
}

/** Typed client for the DevDesk sync API. Framework-independent (uses global fetch). */
export class ApiClient {
  private token: string | null = null

  /** Mutable so the app can repoint at a different server without rebuilding the engine. */
  constructor(public baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init?.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      let message = ''
      try {
        message = JSON.parse(body).error
      } catch {
        /* not JSON */
      }
      throw new Error(message || `Request failed (${res.status})`)
    }
    return res.json() as Promise<T>
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  me(): Promise<{ user: AuthUser }> {
    return this.request('/api/auth/me')
  }

  // Admin-only (403 for everyone else). Used by Administration → Users.
  listUsers(): Promise<{ users: AuthUser[] }> {
    return this.request('/api/admin/users')
  }

  createUser(user: { email: string; name: string; password: string }): Promise<{ user: AuthUser }> {
    return this.request('/api/admin/users', { method: 'POST', body: JSON.stringify(user) })
  }

  renameUser(id: string, name: string): Promise<{ ok: boolean }> {
    return this.request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  }

  resetUserPassword(id: string, password: string): Promise<{ ok: boolean }> {
    return this.request(`/api/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) })
  }

  setUserActive(id: string, active: boolean): Promise<{ ok: boolean }> {
    return this.request(`/api/admin/users/${id}/active`, { method: 'POST', body: JSON.stringify({ active }) })
  }

  bootstrap(): Promise<PullResponse> {
    return this.request('/api/sync/bootstrap')
  }

  push(operations: SyncOperation[]): Promise<PushResult> {
    return this.request('/api/sync/push', { method: 'POST', body: JSON.stringify({ operations }) })
  }

  pull(cursor: string): Promise<PullResponse> {
    return this.request(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}`)
  }

  ack(cursor: string): Promise<{ ok: boolean }> {
    return this.request('/api/sync/ack', { method: 'POST', body: JSON.stringify({ cursor }) })
  }
}
