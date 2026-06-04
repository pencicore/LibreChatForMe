'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api-client';
import { avatarColorIndex, displayInitials, formatDateTime } from '@/lib/format';
import type { AdminOperationLogItem } from '@/types/librechat';
import './operation-logs.css';

type OperationLogsResponse = {
  logs: AdminOperationLogItem[];
  total: number;
  page: number;
  limit: number;
};

const actionOptions = [
  ['ALL', '操作类型：全部'],
  ['ADMIN_LOGIN', '登录'],
  ['USER_BULK_CREATE', '创建用户'],
  ['USER_UPDATE', '更新用户'],
  ['USER_DISABLE', '禁用用户'],
  ['USER_ENABLE', '解除禁用'],
  ['USER_DELETE', '删除用户'],
  ['CONVERSATION_DELETE', '删除会话'],
  ['CONVERSATION_ARCHIVE', '归档会话'],
  ['CONVERSATION_UNARCHIVE', '取消归档'],
] as const;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function adminName(log: AdminOperationLogItem) {
  return log.admin.email || log.admin.username || log.admin.name || 'Admin';
}

function badgeTone(action: string) {
  if (action.includes('DELETE')) {
    return 'red';
  }
  if (action.includes('CREATE') || action.includes('ARCHIVE')) {
    return 'green';
  }
  if (action.includes('UPDATE') || action.includes('ENABLE')) {
    return 'blue';
  }
  if (action.includes('DISABLE')) {
    return 'orange';
  }
  return 'slate';
}

function moduleTone(module: string) {
  if (module === 'accounts') {
    return 'blue';
  }
  if (module === 'chat-records') {
    return 'cyan';
  }
  return 'slate';
}

function compactPages(page: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (page <= 3) {
    return [1, 2, 3, 4, totalPages];
  }
  if (page >= totalPages - 2) {
    return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, page - 1, page, page + 1, totalPages];
}

export function OperationLogsManagement() {
  const [logs, setLogs] = useState<AdminOperationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailLog, setDetailLog] = useState<AdminOperationLogItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pages = useMemo(() => compactPages(page, totalPages), [page, totalPages]);

  const buildParams = useCallback(
    (override?: { exportLimit?: number }) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(override?.exportLimit ?? limit),
      });

      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (moduleFilter !== 'ALL') {
        params.set('module', moduleFilter);
      }
      if (actionFilter !== 'ALL') {
        params.set('action', actionFilter);
      }
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      if (startDate) {
        params.set('startDate', startDate);
      }
      if (endDate) {
        params.set('endDate', endDate);
      }

      return params;
    },
    [actionFilter, endDate, limit, moduleFilter, page, query, startDate, statusFilter],
  );

  const loadLogs = useCallback(async () => {
    const data = await apiFetch<OperationLogsResponse>(`/api/operation-logs?${buildParams()}`);
    setLogs(data.logs);
    setTotal(data.total);
  }, [buildParams]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载日志失败');
    } finally {
      setBusy(false);
    }
  }, [loadLogs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    void refresh();
  }

  function resetFilters() {
    setQuery('');
    setModuleFilter('ALL');
    setActionFilter('ALL');
    setStatusFilter('ALL');
    setStartDate(daysAgo(30));
    setEndDate(today());
    setPage(1);
  }

  async function exportLogs() {
    const response = await fetch(`/api/operation-logs/export?${buildParams({ exportLimit: 50000 })}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? '导出失败');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `operation-logs-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell active="operation-logs">
      <section className="page-heading operation-heading">
        <div>
          <h1>操作日志</h1>
          <p>查看系统中的所有管理员操作记录</p>
        </div>
        <div className="heading-actions">
          <button className="ghost-button" type="button" onClick={() => void exportLogs()} disabled={busy}>
            ⇩ 导出日志
          </button>
          <button className="ghost-button" type="button" onClick={() => void refresh()} disabled={busy}>
            ⟳ 刷新
          </button>
        </div>
      </section>

      {error ? <div className="alert operation-alert">{error}</div> : null}

      <section className="operation-card">
        <form className="operation-toolbar" onSubmit={applyFilters}>
          <div className="search-box operation-search">
            <span>⌕</span>
            <input
              placeholder="搜索操作内容 / 用户名 / IP 地址"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
            <option value="ALL">操作模块：全部</option>
            <option value="accounts">账户管理</option>
            <option value="chat-records">聊天记录</option>
            <option value="system">系统</option>
          </select>
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            {actionOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">状态：全部</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
          <div className="date-range">
            <span>时间范围：</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <b>→</b>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <button className="ghost-button" type="button" onClick={resetFilters}>⟳ 重置</button>
          <button className="ghost-button" type="submit">筛选</button>
        </form>

        <div className="operation-table-wrap">
          <table className="operation-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户名</th>
                <th>操作模块</th>
                <th>操作类型</th>
                <th>操作内容</th>
                <th>状态</th>
                <th>IP 地址</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={8}>{busy ? '加载中...' : '暂无操作日志'}</td>
                </tr>
              ) : (
                logs.map((log) => {
                  const name = adminName(log);
                  return (
                    <tr key={log._id}>
                      <td className="log-time">{formatDateTime(log.createdAt)}</td>
                      <td>
                        <div className="log-user">
                          <span className={`mini-avatar color-${avatarColorIndex(name)}`}>
                            {displayInitials(name, 'AD')}
                          </span>
                          <strong>{name}</strong>
                          {log.admin.role === 'ADMIN' ? <em>ADMIN</em> : null}
                        </div>
                      </td>
                      <td>
                        <span className={`log-chip ${moduleTone(log.module)}`}>{log.moduleLabel}</span>
                      </td>
                      <td>
                        <span className={`log-chip ${badgeTone(log.action)}`}>{log.actionLabel}</span>
                      </td>
                      <td className="log-description">{log.description}</td>
                      <td>
                        <span className={log.status === 'success' ? 'log-status success' : 'log-status failed'}>
                          ● {log.status === 'success' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="mono">{log.ip ?? '-'}</td>
                      <td>
                        <button className="icon-button" type="button" onClick={() => setDetailLog(log)} title="查看详情">
                          ⧉
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="operation-footer">
          <span>共 {total} 条</span>
          <select
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
          <div className="pagination operation-pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
            {pages.map((pageNumber, index) => (
              <button
                key={`${pageNumber}-${index}`}
                className={pageNumber === page ? 'current' : ''}
                type="button"
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button>
          </div>
        </footer>
      </section>

      {detailLog ? (
        <div className="modal-backdrop" onClick={() => setDetailLog(null)}>
          <div className="modal operation-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operation-detail-head">
              <div>
                <h2>日志详情</h2>
                <p>{detailLog.description}</p>
              </div>
              <button className="bulk-modal-close" type="button" onClick={() => setDetailLog(null)}>×</button>
            </div>
            <dl className="operation-detail-grid">
              <dt>时间</dt><dd>{formatDateTime(detailLog.createdAt)}</dd>
              <dt>管理员</dt><dd>{adminName(detailLog)}</dd>
              <dt>模块</dt><dd>{detailLog.moduleLabel}</dd>
              <dt>类型</dt><dd>{detailLog.actionLabel}</dd>
              <dt>状态</dt><dd>{detailLog.status === 'success' ? '成功' : '失败'}</dd>
              <dt>IP</dt><dd>{detailLog.ip ?? '-'}</dd>
              <dt>User-Agent</dt><dd>{detailLog.userAgent ?? '-'}</dd>
            </dl>
            <pre className="operation-detail-json">{JSON.stringify(detailLog.details, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
