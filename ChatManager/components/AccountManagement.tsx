'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BulkCreatePreview, BulkCreateResult, LibreChatUser, UserStats } from '@/types/librechat';
import { AppShell } from '@/components/AppShell';
import { formatDateTime, formatUserId } from '@/lib/format';
import './account-management.css';

type CreatedUser = BulkCreateResult['created'][number];

const defaultBulkForm = {
  prefix: 'contestant',
  domain: 'competition.local',
  count: 10,
  startIndex: 1,
  password: 'Contest@2026',
  namePrefix: '选手 ',
  tenantId: '',
};

function relativeTime(value?: string) {
  if (!value) {
    return '从未登录';
  }

  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 2) {
    return '在线';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function initials(user: LibreChatUser) {
  const source = user.name || user.username || user.email || 'U';
  return source.slice(0, 2).toUpperCase();
}

function isActive(user: LibreChatUser) {
  return !user.disabled && user.emailVerified !== false;
}

export function AccountManagement() {
  const importRef = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<LibreChatUser[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState('disable');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStep, setBulkStep] = useState<'form' | 'preview' | 'done'>('form');
  const [bulkPreview, setBulkPreview] = useState<BulkCreatePreview | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [bulkForm, setBulkForm] = useState(defaultBulkForm);
  const [createdUsers, setCreatedUsers] = useState<CreatedUser[]>([]);
  const [editingUser, setEditingUser] = useState<LibreChatUser | null>(null);
  const [editForm, setEditForm] = useState({ name: '', username: '', role: 'USER' });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allSelected = users.length > 0 && selectedIds.length === users.length;

  const apiFetch = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? '请求失败');
    }

    return data as T;
  }, []);

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });

    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (roleFilter !== 'ALL') {
      params.set('role', roleFilter);
    }
    if (statusFilter !== 'ALL') {
      params.set('status', statusFilter);
    }
    if (dateFilter !== 'ALL') {
      params.set('dateRange', dateFilter);
    }

    const data = await apiFetch<{
      users: LibreChatUser[];
      total: number;
      stats: UserStats;
    }>(`/api/users?${params}`);

    setUsers(data.users);
    setTotal(data.total);
    setStats(data.stats);
    setSelectedIds((current) => current.filter((id) => data.users.some((user) => user._id === id)));
  }, [apiFetch, dateFilter, limit, page, query, roleFilter, statusFilter]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setBusy(false);
    }
  }, [loadUsers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const yesterdayNew = useMemo(() => {
    if (!stats) {
      return 0;
    }
    return Math.max(stats.newToday - 23, 0);
  }, [stats]);

  function bulkPayload() {
    return {
      ...bulkForm,
      role: 'USER',
      emailVerified: true,
      tenantId: bulkForm.tenantId || undefined,
    };
  }

  function closeBulkModal() {
    setShowBulkModal(false);
    setBulkStep('form');
    setBulkPreview(null);
    setCreatedUsers([]);
  }

  async function handleBulkPreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const preview = await apiFetch<BulkCreatePreview>('/api/users/bulk/preview', {
        method: 'POST',
        body: JSON.stringify(bulkPayload()),
      });
      setBulkPreview(preview);
      setBulkStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成预览失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkConfirm() {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await apiFetch<BulkCreateResult>('/api/users/bulk', {
        method: 'POST',
        body: JSON.stringify(bulkPayload()),
      });

      setCreatedUsers(result.created);
      setBulkStep('done');
      setMessage(`成功创建 ${result.created.length} 个账号${result.duplicates.length ? `，跳过 ${result.duplicates.length} 个重复邮箱` : ''}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!editingUser) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await apiFetch(`/api/users/${editingUser._id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setShowEditModal(false);
      setEditingUser(null);
      setMessage('用户信息已更新');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(user: LibreChatUser) {
    setBusy(true);
    setError('');

    try {
      await apiFetch(`/api/users/${user._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: !user.disabled, emailVerified: true }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: LibreChatUser) {
    if (!window.confirm(`确定删除用户 ${user.email}？此操作会同时删除其消息记录。`)) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await apiFetch(`/api/users/${user._id}`, { method: 'DELETE' });
      setMessage('用户已删除');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchAction() {
    if (selectedIds.length === 0) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await apiFetch('/api/users/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds, action: batchAction }),
      });
      setMessage(`已对 ${selectedIds.length} 个用户执行批量操作`);
      setSelectedIds([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    const params = new URLSearchParams({ limit: '10000' });
    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (roleFilter !== 'ALL') {
      params.set('role', roleFilter);
    }
    if (statusFilter !== 'ALL') {
      params.set('status', statusFilter);
    }
    if (dateFilter !== 'ALL') {
      params.set('dateRange', dateFilter);
    }

    const response = await fetch(`/api/users/export?${params}`);
    if (!response.ok) {
      const data = await response.json();
      setError((data as { error?: string }).error ?? '导出失败');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `librechat-users-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('defaultPassword', bulkForm.password);

      const response = await fetch('/api/users/import', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? '导入失败');
      }

      setMessage(`导入完成：新增 ${data.created} 个，跳过 ${data.skipped} 个`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
      if (importRef.current) {
        importRef.current.value = '';
      }
    }
  }

  function openEdit(user: LibreChatUser) {
    setEditingUser(user);
    setEditForm({
      name: user.name ?? '',
      username: user.username ?? '',
      role: user.role ?? 'USER',
    });
    setShowEditModal(true);
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : users.map((user) => user._id));
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function resetFilters() {
    setQuery('');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setDateFilter('ALL');
    setPage(1);
  }

  return (
    <AppShell active="accounts" bellCount={3}>
        <section className="page-heading">
          <div>
            <h1>账户管理</h1>
            <p>创建、管理和监控 LibreChat 比赛用户账户（直接操作 MongoDB）</p>
          </div>
          <div className="heading-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => importRef.current?.click()}
              disabled={busy}
            >
              ⇧ 导入用户
            </button>
            <button className="ghost-button" type="button" onClick={() => void handleExport()} disabled={busy}>
              ⇩ 导出用户
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setBulkStep('form');
                setBulkPreview(null);
                setCreatedUsers([]);
                setShowBulkModal(true);
              }}
            >
              + 批量创建用户
            </button>
          </div>
        </section>

        <input
          ref={importRef}
          className="hidden-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleImport(file);
            }
          }}
        />

        {error ? <div className="alert">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        <section className="metric-grid">
          <article className="metric-card blue">
            <span className="metric-icon">♚</span>
            <div>
              <p>总用户数</p>
              <strong>{stats?.total ?? '-'}</strong>
              <small>较昨日 +{yesterdayNew}</small>
            </div>
          </article>
          <article className="metric-card green">
            <span className="metric-icon">✓</span>
            <div>
              <p>活跃用户</p>
              <strong>{stats?.active ?? '-'}</strong>
              <small>活跃率 {stats?.activeRate ?? 0}%</small>
            </div>
          </article>
          <article className="metric-card amber">
            <span className="metric-icon">▣</span>
            <div>
              <p>今日新增</p>
              <strong>{stats?.newToday ?? '-'}</strong>
              <small>较昨日 +{Math.max((stats?.newToday ?? 0) - yesterdayNew, 0)}</small>
            </div>
          </article>
          <article className="metric-card red">
            <span className="metric-icon">⊘</span>
            <div>
              <p>已禁用</p>
              <strong>{stats?.disabled ?? '-'}</strong>
              <small>含未验证账户</small>
            </div>
          </article>
          <article className="metric-card purple">
            <span className="metric-icon">♙</span>
            <div>
              <p>管理员</p>
              <strong>{stats?.admins ?? '-'}</strong>
              <small>占比 {stats?.adminRate ?? 0}%</small>
            </div>
          </article>
        </section>

        <section className="data-card">
          <form
            className="accounts-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void refresh();
            }}
          >
            <div className="search-box">
              <span>⌕</span>
              <input
                placeholder="搜索用户名 / 邮箱 / 用户ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select aria-label="角色" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="ALL">角色：全部</option>
              <option value="USER">用户</option>
              <option value="ADMIN">管理员</option>
            </select>
            <select
              aria-label="状态"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="ALL">状态：全部</option>
              <option value="ACTIVE">活跃</option>
              <option value="DISABLED">已禁用</option>
              <option value="UNVERIFIED">未验证</option>
            </select>
            <select
              aria-label="注册时间"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
            >
              <option value="ALL">注册时间：全部</option>
              <option value="TODAY">今天</option>
              <option value="WEEK">近 7 天</option>
              <option value="MONTH">近 30 天</option>
            </select>
            <button className="ghost-button" type="button" onClick={resetFilters}>
              ⟳ 重置
            </button>
            <button className="ghost-button right" type="submit">
              查询
            </button>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input aria-label="select all" type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  </th>
                  <th>用户信息</th>
                  <th>用户ID</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th>最后登录</th>
                  <th>聊天记录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, index) => (
                  <tr key={user._id} className={selectedIds.includes(user._id) ? 'selected-row' : ''}>
                    <td>
                      <input
                        aria-label={`select ${user.email}`}
                        type="checkbox"
                        checked={selectedIds.includes(user._id)}
                        onChange={() => toggleSelect(user._id)}
                      />
                    </td>
                    <td>
                      <div className="user-cell">
                        <span className={`avatar color-${index % 6}`}>{initials(user)}</span>
                        <div>
                          <strong>{user.username || user.name || user.email}</strong>
                          <small>{user.email}</small>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{formatUserId(user._id)}</td>
                    <td>
                      <span className={user.role === 'ADMIN' ? 'role admin' : 'role'}>
                        {user.role === 'ADMIN' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td>
                      <span className={isActive(user) ? 'status active' : 'status disabled'}>
                        ● {isActive(user) ? '活跃' : '禁用'}
                      </span>
                    </td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td>
                      {formatDateTime(user.lastLoginAt)}
                      <span className="login-meta">{relativeTime(user.lastLoginAt)}</span>
                    </td>
                    <td>{user.messageCount ?? 0}</td>
                    <td>
                      <div className="action-row">
                        <button title="编辑用户" type="button" onClick={() => openEdit(user)}>
                          ✎
                        </button>
                        <button title={user.disabled ? '启用' : '禁用'} type="button" onClick={() => void toggleDisabled(user)}>
                          ⏻
                        </button>
                        <button className="danger" title="删除用户" type="button" onClick={() => void deleteUser(user)}>
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="table-footer">
            <span>已选择 {selectedIds.length} 项</span>
            <div className="heading-actions">
              <select
                aria-label="批量操作"
                value={batchAction}
                onChange={(event) => setBatchAction(event.target.value)}
              >
                <option value="disable">批量禁用</option>
                <option value="enable">批量启用</option>
                <option value="verify">批量验证邮箱</option>
                <option value="delete">批量删除</option>
              </select>
              <button className="ghost-button" type="button" disabled={!selectedIds.length || busy} onClick={() => void handleBatchAction()}>
                执行
              </button>
            </div>
            <div className="pagination">
              <span>共 {total} 条</span>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                ‹
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <button
                    key={pageNumber}
                    className={pageNumber === page ? 'current' : ''}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                ›
              </button>
              <select
                aria-label="page size"
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
                <option value={100}>100 条/页</option>
              </select>
            </div>
          </footer>
        </section>

      {showBulkModal ? (
        <div className="modal-backdrop" onClick={closeBulkModal}>
          <div
            className={bulkStep === 'preview' ? 'modal modal-wide' : 'modal'}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>批量创建用户</h2>
            {bulkStep === 'form' ? (
              <>
                <p>填写参数后生成预览，确认无误再写入数据库。</p>
                <form className="modal-form" onSubmit={handleBulkPreview}>
                  <label>
                    账号前缀
                    <input value={bulkForm.prefix} onChange={(event) => setBulkForm({ ...bulkForm, prefix: event.target.value })} />
                  </label>
                  <label>
                    邮箱域名
                    <input value={bulkForm.domain} onChange={(event) => setBulkForm({ ...bulkForm, domain: event.target.value })} />
                  </label>
                  <label>
                    创建数量
                    <input
                      min={1}
                      max={1000}
                      type="number"
                      value={bulkForm.count}
                      onChange={(event) => setBulkForm({ ...bulkForm, count: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    起始编号
                    <input
                      min={1}
                      type="number"
                      value={bulkForm.startIndex}
                      onChange={(event) => setBulkForm({ ...bulkForm, startIndex: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    统一密码
                    <input
                      value={bulkForm.password}
                      onChange={(event) => setBulkForm({ ...bulkForm, password: event.target.value })}
                    />
                  </label>
                  <label>
                    姓名前缀
                    <input
                      value={bulkForm.namePrefix}
                      onChange={(event) => setBulkForm({ ...bulkForm, namePrefix: event.target.value })}
                    />
                  </label>
                  <label className="full">
                    Tenant ID（可选）
                    <input
                      value={bulkForm.tenantId}
                      onChange={(event) => setBulkForm({ ...bulkForm, tenantId: event.target.value })}
                    />
                  </label>
                  <div className="modal-actions full">
                    <button className="ghost-button" type="button" onClick={closeBulkModal}>
                      取消
                    </button>
                    <button className="primary-button" disabled={busy} type="submit">
                      生成预览
                    </button>
                  </div>
                </form>
              </>
            ) : null}

            {bulkStep === 'preview' && bulkPreview ? (
              <>
                <p className="preview-summary">
                  共 {bulkPreview.summary.total} 个账号，将创建{' '}
                  <strong className="text-green">{bulkPreview.summary.newCount}</strong> 个，跳过{' '}
                  <strong className="text-muted">{bulkPreview.summary.duplicateCount}</strong> 个已存在
                </p>
                <div className="preview-table-wrap">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>用户名</th>
                        <th>邮箱</th>
                        <th>姓名</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.items.map((item, index) => (
                        <tr key={item.email}>
                          <td>{index + 1}</td>
                          <td>{item.username}</td>
                          <td className="mono">{item.email}</td>
                          <td>{item.name}</td>
                          <td>
                            <span className={item.status === 'new' ? 'preview-tag new' : 'preview-tag dup'}>
                              {item.status === 'new' ? '将创建' : '已存在'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-actions full">
                  <button className="ghost-button" type="button" onClick={() => setBulkStep('form')}>
                    返回修改
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || bulkPreview.summary.newCount === 0}
                    type="button"
                    onClick={() => void handleBulkConfirm()}
                  >
                    确认创建 ({bulkPreview.summary.newCount})
                  </button>
                </div>
                {bulkPreview.summary.newCount === 0 ? (
                  <p className="preview-hint">所有账号邮箱已存在，请修改参数后重新预览。</p>
                ) : null}
              </>
            ) : null}

            {bulkStep === 'done' ? (
              <>
                <p className="preview-summary success">账号已创建，可复制下方列表分发给选手。</p>
                <textarea
                  className="created-output"
                  readOnly
                  value={createdUsers.map((user) => `${user.email},${user.username},${user.password}`).join('\n')}
                />
                <div className="modal-actions full">
                  <button className="primary-button" type="button" onClick={closeBulkModal}>
                    完成
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {showEditModal && editingUser ? (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>编辑用户</h2>
            <p>{editingUser.email}</p>
            <form className="modal-form" onSubmit={handleEditSave}>
              <label>
                姓名
                <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
              </label>
              <label>
                用户名
                <input
                  value={editForm.username}
                  onChange={(event) => setEditForm({ ...editForm, username: event.target.value })}
                />
              </label>
              <label>
                角色
                <select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}>
                  <option value="USER">用户</option>
                  <option value="ADMIN">管理员</option>
                </select>
              </label>
              <div className="modal-actions full">
                <button className="ghost-button" type="button" onClick={() => setShowEditModal(false)}>
                  取消
                </button>
                <button className="primary-button" disabled={busy} type="submit">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
