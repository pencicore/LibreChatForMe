'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { MessageBody } from '@/components/MessageBody';
import { formatDateTime, formatTime, formatUserId } from '@/lib/format';
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationStats,
  ConversationTab,
  LibreChatMessage,
  LibreChatUser,
} from '@/types/librechat';
import './chat-records.css';

function convoInitials(item: ConversationListItem) {
  const source = item.username || item.email || item.title || 'CH';
  return source.slice(0, 2).toUpperCase();
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function ChatRecordsManagement() {
  const defaultRange = useMemo(() => defaultDateRange(), []);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [stats, setStats] = useState<ConversationStats | null>(null);
  const [users, setUsers] = useState<LibreChatUser[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [messagePage, setMessagePage] = useState(1);
  const [tab, setTab] = useState<ConversationTab>('ALL');
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('ALL');
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [tagInput, setTagInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const apiFetch = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? '请求失败');
    }
    return data as T;
  }, []);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        tab,
        sort,
        ...(extra ?? {}),
      });
      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (userId !== 'ALL') {
        params.set('userId', userId);
      }
      if (startDate) {
        params.set('startDate', startDate);
      }
      if (endDate) {
        params.set('endDate', endDate);
      }
      return params;
    },
    [endDate, limit, page, query, sort, startDate, tab, userId],
  );

  const loadUsers = useCallback(async () => {
    const data = await apiFetch<{ users: LibreChatUser[] }>('/api/users?limit=200&page=1');
    setUsers(data.users);
  }, [apiFetch]);

  const loadConversations = useCallback(async () => {
    const data = await apiFetch<{
      conversations: ConversationListItem[];
      total: number;
      stats: ConversationStats;
    }>(`/api/chat-records?${buildParams()}`);
    setConversations(data.conversations);
    setTotal(data.total);
    setStats(data.stats);
    if (data.conversations.length === 0) {
      setSelectedId('');
      setDetail(null);
      return;
    }
    setSelectedId((current) =>
      data.conversations.some((item) => item.conversationId === current)
        ? current
        : data.conversations[0].conversationId,
    );
  }, [apiFetch, buildParams]);

  const loadDetail = useCallback(async (conversationId: string, msgPage: number) => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    const params = new URLSearchParams({
      messagePage: String(msgPage),
      messageLimit: '20',
    });
    const data = await apiFetch<{ conversation: ConversationDetail }>(
      `/api/chat-records/${encodeURIComponent(conversationId)}?${params}`,
    );
    setDetail(data.conversation);
    setNotesDraft(data.conversation.chatManagerNotes ?? '');
    setMessagePage(data.conversation.messagePage);
  }, [apiFetch]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setBusy(false);
    }
  }, [loadConversations]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId, messagePage);
    }
  }, [messagePage, selectedId, loadDetail]);

  function resetFilters() {
    setQuery('');
    setUserId('ALL');
    setStartDate(defaultRange.start);
    setEndDate(defaultRange.end);
    setTab('ALL');
    setPage(1);
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    await refresh();
  }

  async function handleExport() {
    const response = await fetch(`/api/chat-records/export?${buildParams()}`);
    if (!response.ok) {
      const data = await response.json();
      setError((data as { error?: string }).error ?? '导出失败');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `chat-records-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveMeta(patch: { tags?: string[]; chatManagerNotes?: string; archived?: boolean }) {
    if (!selectedId) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/chat-records/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMessage('会话信息已保存');
      await Promise.all([refresh(), loadDetail(selectedId, messagePage)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConversation() {
    if (!selectedId || !window.confirm('确定删除该会话及全部消息？')) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/chat-records/${encodeURIComponent(selectedId)}`, { method: 'DELETE' });
      setMessage('会话已删除');
      setSelectedId('');
      setDetail(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
    setMessage('已复制到剪贴板');
  }

  function addTag() {
    const value = tagInput.trim();
    if (!value || !detail) {
      return;
    }
    const tags = [...(detail.tags ?? [])];
    if (!tags.includes(value)) {
      tags.push(value);
    }
    setTagInput('');
    void saveMeta({ tags });
  }

  function removeTag(tag: string) {
    if (!detail) {
      return;
    }
    void saveMeta({ tags: (detail.tags ?? []).filter((item) => item !== tag) });
  }

  return (
    <AppShell active="chat-records">
      <div className="chat-page">
        <section className="page-heading">
          <div>
            <h1>聊天记录</h1>
            <p>查看和管理用户的所有聊天记录</p>
          </div>
          <div className="filter-actions">
            <button className="ghost-button" type="button" onClick={() => void handleExport()} disabled={busy}>
              ⇩ 导出记录
            </button>
          </div>
        </section>

        {error ? <div className="alert">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        <div className="chat-filter-wrap">
          <form className="chat-filter-bar" onSubmit={handleSearch}>
            <div className="search-box">
              <span>⌕</span>
              <input
                placeholder="搜索用户 / 对话标题 / 消息内容"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              className="filter-select"
              aria-label="用户"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="ALL">用户：全部</option>
              {users.map((user) => (
                <option key={user._id} value={user._id}>
                  {user.username || user.email}
                </option>
              ))}
            </select>
            <select className="filter-select" aria-label="排序" value={sort} onChange={(event) => setSort(event.target.value as 'latest' | 'oldest')}>
              <option value="latest">排序：最新</option>
              <option value="oldest">排序：最早</option>
            </select>
            <div className="date-range">
              <label>时间范围</label>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <span>→</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <button className="ghost-button" type="button" onClick={resetFilters}>
              重置
            </button>
            <div className="filter-actions">
              <button className="primary-button" type="submit">
                查询
              </button>
            </div>
          </form>
        </div>

        <div className="chat-tabs">
          {(
            [
              ['ALL', '全部会话', stats?.all],
              ['ACTIVE', '活跃会话', stats?.active],
              ['ARCHIVED', '已归档会话', stats?.archived],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              className={tab === key ? 'chat-tab active' : 'chat-tab'}
              type="button"
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
            >
              {label}
              <span>{count ?? '-'}</span>
            </button>
          ))}
        </div>

        <div className="chat-workspace">
          <section className="convo-panel">
            <div className="convo-panel-header">
              <span>会话列表</span>
              <select
                aria-label="排序"
                value={sort}
                onChange={(event) => setSort(event.target.value as 'latest' | 'oldest')}
              >
                <option value="latest">最新消息时间</option>
                <option value="oldest">最早消息时间</option>
              </select>
            </div>
            <div className="convo-list">
              {conversations.length === 0 ? (
                <div className="empty-state">暂无会话记录</div>
              ) : (
                conversations.map((item, index) => (
                  <button
                    key={item.conversationId}
                    className={item.conversationId === selectedId ? 'convo-item active' : 'convo-item'}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.conversationId);
                      setMessagePage(1);
                    }}
                  >
                    <span className={`avatar color-${index % 6}`}>{convoInitials(item)}</span>
                    <div className="convo-item-body">
                      <strong>{item.title}</strong>
                      <small>{item.lastMessagePreview || '暂无消息预览'}</small>
                    </div>
                    <div className="convo-item-meta">
                      <time>{formatTime(item.lastMessageAt)}</time>
                      <span className="convo-badge">{item.messageCount}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
            <footer className="convo-pagination">
              <span>共 {total} 条</span>
              <div className="pagination">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  ‹
                </button>
                <button className="current" type="button">
                  {page}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  ›
                </button>
              </div>
            </footer>
          </section>

          <section className="messages-panel">
            {!detail ? (
              <div className="empty-state">请选择左侧会话查看消息详情</div>
            ) : (
              <>
                <header className="messages-header">
                  <h2>{detail.title}</h2>
                  <div className="messages-meta">
                    <span title={detail.email}>用户：{detail.username || detail.email || detail.userId}</span>
                    <span>创建：{formatDateTime(detail.createdAt)}</span>
                    <span>最新：{formatDateTime(detail.lastMessageAt)}</span>
                    <span>消息数：{detail.messageTotal}</span>
                    {detail.model ? <span title={detail.model}>模型：{detail.model}</span> : null}
                  </div>
                  <div className="messages-header-actions">
                    {detail.userId ? (
                      <Link className="ghost-button" href="/">
                        查看用户
                      </Link>
                    ) : null}
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void saveMeta({ archived: !detail.archived })}
                    >
                      {detail.archived ? '取消归档' : '归档会话'}
                    </button>
                    <button className="danger-button" type="button" onClick={() => void handleDeleteConversation()}>
                      删除会话
                    </button>
                  </div>
                </header>

                <div className="message-feed">
                  {detail.messages.map((msg: LibreChatMessage, index) => (
                    <article
                      key={msg._id}
                      className={msg.isCreatedByUser ? 'chat-message user' : 'chat-message assistant'}
                    >
                      <span className="msg-avatar">{msg.isCreatedByUser ? 'U' : 'AI'}</span>
                      <div>
                        <div className="msg-head">
                          <strong>
                            {msg.isCreatedByUser
                              ? detail.username || '用户'
                              : msg.sender || 'AI Assistant'}
                          </strong>
                          <time>{formatDateTime(msg.createdAt)}</time>
                        </div>
                        <div className="msg-body">
                          <MessageBody
                            text={msg.displayText}
                            thinking={msg.thinkingText}
                            extras={msg.extras}
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <footer className="message-nav">
                  <button
                    type="button"
                    disabled={messagePage <= 1}
                    onClick={() => setMessagePage((value) => Math.max(1, value - 1))}
                  >
                    ‹
                  </button>
                  <span>
                    {messagePage} / {detail.messagePages}
                  </span>
                  <button
                    type="button"
                    disabled={messagePage >= detail.messagePages}
                    onClick={() => setMessagePage((value) => value + 1)}
                  >
                    ›
                  </button>
                </footer>
              </>
            )}
          </section>

          <aside className="detail-panel">
            <h3>会话详情</h3>
            {detail ? (
              <>
                <div className="detail-field">
                  <label>会话 ID</label>
                  <div className="value-row">
                    <span className="value mono">{detail.conversationId}</span>
                    <button className="copy-button" type="button" onClick={() => copyText(detail.conversationId)}>
                      复制
                    </button>
                  </div>
                </div>
                <div className="detail-field">
                  <label>用户</label>
                  <div className="value-row">
                    <span className="value">
                      {detail.username || detail.email}
                      <br />
                      <span className="mono">{formatUserId(detail.userId)}</span>
                    </span>
                    <button className="copy-button" type="button" onClick={() => copyText(detail.userId)}>
                      复制
                    </button>
                  </div>
                </div>
                <div className="detail-field">
                  <label>创建时间</label>
                  <span className="value">{formatDateTime(detail.createdAt)}</span>
                </div>
                <div className="detail-field">
                  <label>最新消息时间</label>
                  <span className="value">{formatDateTime(detail.lastMessageAt)}</span>
                </div>
                <div className="detail-field">
                  <label>消息总数</label>
                  <span className="value">{detail.messageTotal}</span>
                </div>
                <div className="detail-field">
                  <label>模型</label>
                  <span className="value">{detail.model || '-'}</span>
                </div>
                <div className="detail-field">
                  <label>状态</label>
                  <span className={detail.archived ? 'status-pill archived' : 'status-pill'}>
                    ● {detail.archived ? '已归档' : '活跃'}
                  </span>
                </div>
                <div className="detail-field">
                  <label>标签</label>
                  <div className="tag-list">
                    {(detail.tags ?? []).map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                        <button type="button" onClick={() => removeTag(tag)}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="value-row" style={{ marginTop: 6 }}>
                    <input
                      placeholder="新标签"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <button className="ghost-button" type="button" onClick={addTag}>
                      + 添加
                    </button>
                  </div>
                </div>
                <div className="detail-field">
                  <label>备注</label>
                  <textarea
                    className="notes-input"
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                  />
                  <button
                    className="primary-button"
                    style={{ marginTop: 6 }}
                    type="button"
                    disabled={busy}
                    onClick={() => void saveMeta({ chatManagerNotes: notesDraft })}
                  >
                    保存备注
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">选择会话后显示详情</div>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
