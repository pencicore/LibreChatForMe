'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api-client';
import { formatCompactNumber, formatCount, formatPercent, truncateLabel } from '@/lib/format';
import type { DashboardGranularity, DashboardStats, LibreChatUser } from '@/types/librechat';
import './dashboard.css';

const PIE_COLORS = ['#1262ff', '#12a44d', '#f08a17', '#7938dc', '#38bdf8', '#94a3b8'];
const CHART_BLUE = '#1262ff';
const CHART_HEIGHT = 300;

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function userOptionLabel(user: LibreChatUser) {
  if (user.username?.trim()) {
    return user.username.trim();
  }
  if (user.name?.trim()) {
    return user.name.trim();
  }
  return user.email.split('@')[0] ?? user.email;
}

function formatTrendLabel(date: string, granularity: DashboardGranularity) {
  if (granularity === 'week') {
    return date.replace(/^\d{4}-W/, 'W');
  }

  if (granularity === 'hour') {
    const [dayPart, hourPart = ''] = date.split(' ');
    const [, month, day] = dayPart.split('-');
    return `${month}-${day} ${hourPart.slice(0, 2)}时`;
  }

  if (granularity === 'minute') {
    const [dayPart, timePart = ''] = date.split(' ');
    const [, month, day] = dayPart.split('-');
    return `${month}-${day} ${timePart}`;
  }

  const [, month, day] = date.split('-');
  return `${month}-${day}`;
}

function estimateAxisWidth(labels: string[], min = 120, max = 300) {
  const longest = labels.reduce((current, label) => Math.max(current, label.length), 0);
  return Math.min(max, Math.max(min, longest * 6.5 + 20));
}

function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="dashboard-tooltip">
      <strong>{title}</strong>
      {rows.map((row) => (
        <span key={row.label}>
          {row.label} {row.value}
        </span>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  controls,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`dashboard-card${className ? ` ${className}` : ''}`}>
      <div className="dashboard-card-head">
        <div className="dashboard-card-title">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {controls ? <div className="dashboard-card-controls">{controls}</div> : null}
      </div>
      <div className="dashboard-chart">{children}</div>
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="dashboard-empty">
      <span>{message}</span>
    </div>
  );
}

export function Dashboard() {
  const defaultRange = useMemo(() => defaultDateRange(), []);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<LibreChatUser[]>([]);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [trendUserId, setTrendUserId] = useState('ALL');
  const [granularity, setGranularity] = useState<DashboardGranularity>('day');
  const [topUsers, setTopUsers] = useState(5);
  const [topRatioUsers, setTopRatioUsers] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    const data = await apiFetch<{ users: LibreChatUser[] }>('/api/users?limit=200&page=1');
    setUsers(data.users);
  }, []);

  const loadStats = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        granularity,
        topUsers: String(topUsers),
        topRatioUsers: String(topRatioUsers),
      });

      if (trendUserId !== 'ALL') {
        params.set('trendUserId', trendUserId);
      }

      const data = await apiFetch<{ stats: DashboardStats }>(`/api/dashboard?${params.toString()}`);
      setStats(data.stats);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setBusy(false);
    }
  }, [endDate, granularity, startDate, topRatioUsers, topUsers, trendUserId]);

  useEffect(() => {
    void loadUsers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : '用户列表加载失败');
    });
  }, [loadUsers]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const pieData = useMemo(() => {
    if (!stats) {
      return [];
    }

    const items = stats.userDistribution.top.map((item, index) => ({
      name: truncateLabel(item.label, 16),
      fullName: item.label,
      value: item.tokens,
      percentage: item.percentage,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));

    if (stats.userDistribution.others) {
      items.push({
        name: '其他用户',
        fullName: '其他用户',
        value: stats.userDistribution.others.tokens,
        percentage: stats.userDistribution.others.percentage,
        color: PIE_COLORS[5],
      });
    }

    return items;
  }, [stats]);

  const trendData = useMemo(
    () =>
      stats?.tokenTrend.map((item) => ({
        ...item,
        label: formatTrendLabel(item.date, granularity),
      })) ?? [],
    [granularity, stats],
  );

  const trendTickInterval = useMemo(() => {
    if (granularity === 'minute') {
      return Math.max(0, Math.floor(trendData.length / 8) - 1);
    }
    if (granularity === 'hour') {
      return Math.max(0, Math.floor(trendData.length / 10) - 1);
    }
    return 0;
  }, [granularity, trendData.length]);

  const modelData = useMemo(() => stats?.modelUsage ?? [], [stats]);
  const modelAxisWidth = useMemo(
    () => estimateAxisWidth(modelData.map((item) => item.model)),
    [modelData],
  );
  const modelChartHeight = Math.max(CHART_HEIGHT, modelData.length * 34 + 24);

  const ratioData = useMemo(
    () =>
      stats?.tokensPerSession.map((item) => ({
        ...item,
        shortLabel: truncateLabel(item.label, 12),
      })) ?? [],
    [stats],
  );

  const hasTrendData = trendData.some((item) => item.tokens > 0);

  return (
    <AppShell active="dashboard">
      <div className="page-heading">
        <div>
          <h1>仪表盘</h1>
          <p>系统使用情况总览与分析</p>
        </div>
        <div className="heading-actions dashboard-filters">
          <div className="dashboard-date-range">
            <input
              aria-label="开始日期"
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
            <span>~</span>
            <input
              aria-label="结束日期"
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </div>
          <button className="primary-button" disabled={busy} onClick={() => void loadStats()} type="button">
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="dashboard-summary">
        <article className="dashboard-summary-card">
          <span>总 Token 消耗</span>
          <strong>{formatCount(stats?.summary.totalTokens ?? 0)}</strong>
        </article>
        <article className="dashboard-summary-card">
          <span>活跃用户</span>
          <strong>{formatCount(stats?.summary.activeUsers ?? 0)}</strong>
        </article>
        <article className="dashboard-summary-card">
          <span>会话总数</span>
          <strong>{formatCount(stats?.summary.totalSessions ?? 0)}</strong>
        </article>
        <article className="dashboard-summary-card">
          <span>使用模型数</span>
          <strong>{formatCount(stats?.summary.modelCount ?? 0)}</strong>
        </article>
      </div>

      <div className={`dashboard-grid${busy ? ' is-loading' : ''}`}>
        <ChartCard
          controls={
            <>
              <select
                aria-label="趋势粒度"
                className="dashboard-select compact"
                onChange={(event) => setGranularity(event.target.value as DashboardGranularity)}
                value={granularity}
              >
                <option value="minute">按分钟</option>
                <option value="hour">按小时</option>
                <option value="day">按天</option>
                <option value="week">按周</option>
              </select>
              <select
                aria-label="趋势用户"
                className="dashboard-select compact"
                onChange={(event) => setTrendUserId(event.target.value)}
                value={trendUserId}
              >
                <option value="ALL">全部用户</option>
                {users.map((user) => (
                  <option key={user._id} value={user._id}>
                    {userOptionLabel(user)}
                  </option>
                ))}
              </select>
            </>
          }
          subtitle="按时间查看 Token 消耗变化"
          title="Token 消耗量趋势"
        >
          {!hasTrendData ? (
            <EmptyChart message="当前时间范围内暂无 Token 消耗记录" />
          ) : (
            <ResponsiveContainer height={CHART_HEIGHT} width="100%">
              <AreaChart data={trendData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tokenTrendFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#1262ff" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#1262ff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#edf1f7" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  interval={trendTickInterval}
                  minTickGap={12}
                  stroke="#8b97aa"
                  tick={{ fill: '#8b97aa', fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  stroke="#8b97aa"
                  tick={{ fill: '#8b97aa', fontSize: 11 }}
                  tickFormatter={(value: number) => formatCompactNumber(value)}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }

                    return (
                      <ChartTooltip
                        rows={[{ label: 'Token 消耗量', value: formatCount(Number(payload[0]?.value ?? 0)) }]}
                        title={String((payload[0]?.payload as { date?: string })?.date ?? label)}
                      />
                    );
                  }}
                />
                <Area
                  activeDot={{ fill: CHART_BLUE, r: 4, stroke: '#fff', strokeWidth: 2 }}
                  dataKey="tokens"
                  fill="url(#tokenTrendFill)"
                  stroke={CHART_BLUE}
                  strokeWidth={2.5}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          className="dashboard-card-donut"
          controls={
            <select
              aria-label="Top 用户数"
              className="dashboard-select compact"
              onChange={(event) => setTopUsers(Number(event.target.value))}
              value={topUsers}
            >
              {[3, 5, 8, 10].map((value) => (
                <option key={value} value={value}>
                  TOP {value}
                </option>
              ))}
            </select>
          }
          subtitle="按用户占比查看消耗分布"
          title={`用户 Token 消耗分布 (TOP ${topUsers})`}
        >
          {pieData.length === 0 ? (
            <EmptyChart message="暂无用户 Token 消耗数据" />
          ) : (
            <div className="dashboard-donut-layout">
              <div className="dashboard-donut-chart">
                <ResponsiveContainer height={CHART_HEIGHT} width="100%">
                  <PieChart>
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={pieData}
                      dataKey="value"
                      innerRadius="58%"
                      nameKey="name"
                      outerRadius="82%"
                      paddingAngle={2}
                      stroke="none"
                    >
                      {pieData.map((entry) => (
                        <Cell fill={entry.color} key={entry.name} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) {
                          return null;
                        }

                        const item = payload[0]?.payload as (typeof pieData)[number];
                        return (
                          <ChartTooltip
                            rows={[
                              { label: 'Token', value: formatCount(item.value) },
                              { label: '占比', value: formatPercent(item.percentage) },
                            ]}
                            title={item.fullName}
                          />
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dashboard-donut-center">
                  <span>总计</span>
                  <strong>{formatCompactNumber(stats?.userDistribution.total ?? 0)}</strong>
                  <em>Tokens</em>
                </div>
              </div>
              <div className="dashboard-legend-wrap">
                <table className="dashboard-legend-table">
                  <thead>
                    <tr>
                      <th aria-hidden="true" className="dashboard-legend-dot-col" />
                      <th>用户</th>
                      <th>Token</th>
                      <th>占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieData.map((item) => (
                      <tr key={item.name}>
                        <td>
                          <span className="dashboard-legend-dot" style={{ background: item.color }} />
                        </td>
                        <td className="dashboard-legend-name" title={item.fullName}>
                          {item.name}
                        </td>
                        <td className="dashboard-legend-value">{formatCount(item.value)}</td>
                        <td className="dashboard-legend-percent">{formatPercent(item.percentage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard
          className="dashboard-card-model"
          subtitle="各模型 Token 消耗对比"
          title="不同模型的 Token 消耗量"
        >
          {modelData.length === 0 ? (
            <EmptyChart message="暂无模型 Token 消耗数据" />
          ) : (
            <ResponsiveContainer height={modelChartHeight} width="100%">
              <BarChart
                data={modelData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="#edf1f7" strokeDasharray="4 4" />
                <XAxis
                  axisLine={false}
                  stroke="#8b97aa"
                  tick={{ fill: '#8b97aa', fontSize: 11 }}
                  tickFormatter={(value: number) => formatCompactNumber(value)}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="model"
                  stroke="#8b97aa"
                  tick={{ fill: '#354157', fontSize: 10 }}
                  tickLine={false}
                  type="category"
                  width={modelAxisWidth}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }

                    const item = payload[0]?.payload as (typeof modelData)[number];
                    return (
                      <ChartTooltip
                        rows={[{ label: 'Token 消耗', value: formatCount(item.tokens) }]}
                        title={item.model}
                      />
                    );
                  }}
                />
                <Bar barSize={16} dataKey="tokens" fill={CHART_BLUE} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          controls={
            <select
              aria-label="会话效率 Top 用户数"
              className="dashboard-select compact"
              onChange={(event) => setTopRatioUsers(Number(event.target.value))}
              value={topRatioUsers}
            >
              {[5, 10, 15, 20].map((value) => (
                <option key={value} value={value}>
                  TOP {value}
                </option>
              ))}
            </select>
          }
          subtitle="平均每会话 Token 消耗（越高代表单次对话消耗越多）"
          title={`用户 Token 消耗量 / 会话次数 (TOP ${topRatioUsers})`}
        >
          {ratioData.length === 0 ? (
            <EmptyChart message="暂无会话效率数据" />
          ) : (
            <ResponsiveContainer height={CHART_HEIGHT} width="100%">
              <BarChart
                data={ratioData}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="#edf1f7" strokeDasharray="4 4" />
                <XAxis
                  axisLine={false}
                  stroke="#8b97aa"
                  tick={{ fill: '#8b97aa', fontSize: 11 }}
                  tickFormatter={(value: number) => formatCompactNumber(value)}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="shortLabel"
                  stroke="#8b97aa"
                  tick={{ fill: '#354157', fontSize: 11 }}
                  tickLine={false}
                  type="category"
                  width={88}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }

                    const item = payload[0]?.payload as (typeof ratioData)[number];
                    return (
                      <ChartTooltip
                        rows={[
                          { label: 'Token / 会话', value: formatCount(item.ratio) },
                          { label: '总 Token', value: formatCount(item.tokens) },
                          { label: '会话数', value: formatCount(item.sessions) },
                        ]}
                        title={item.label}
                      />
                    );
                  }}
                />
                <Bar barSize={16} dataKey="ratio" fill={CHART_BLUE} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </AppShell>
  );
}
