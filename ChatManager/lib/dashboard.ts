import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import type { DashboardGranularity, DashboardStats } from '@/types/librechat';

const DASHBOARD_TIMEZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Shanghai';
const MAX_MODEL_BARS = 8;

type DashboardQuery = {
  startDate?: string | null;
  endDate?: string | null;
  userId?: string | null;
  trendUserId?: string | null;
  granularity?: DashboardGranularity;
  topUsers?: number;
  topRatioUsers?: number;
};

type UserDoc = {
  _id: ObjectId;
  username?: string;
  name?: string;
  email?: string;
};

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function formatCalendarDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addCalendarDays(year: number, month: number, day: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function compareCalendarDates(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number },
) {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

function buildDateRange(startDate?: string | null, endDate?: string | null) {
  const range: Record<string, Date> = {};

  if (startDate) {
    range.$gte = new Date(`${startDate}T00:00:00.000`);
  }
  if (endDate) {
    range.$lte = new Date(`${endDate}T23:59:59.999`);
  }

  return Object.keys(range).length > 0 ? range : null;
}

function buildTransactionMatch(options: {
  startDate?: string | null;
  endDate?: string | null;
  userId?: string | null;
}) {
  const match: Record<string, unknown> = {
    tokenType: { $in: ['prompt', 'completion'] },
    rawAmount: { $lt: 0 },
  };

  const createdAt = buildDateRange(options.startDate, options.endDate);
  if (createdAt) {
    match.createdAt = createdAt;
  }

  const userId = options.userId?.trim();
  if (userId && ObjectId.isValid(userId)) {
    match.user = new ObjectId(userId);
  }

  return match;
}

function buildConversationMatch(options: {
  startDate?: string | null;
  endDate?: string | null;
  userId?: string | null;
}) {
  const match: Record<string, unknown> = {};

  const createdAt = buildDateRange(options.startDate, options.endDate);
  if (createdAt) {
    match.createdAt = createdAt;
  }

  const userId = options.userId?.trim();
  if (userId) {
    match.user = userId;
  }

  return match;
}

function tokenAmountExpression() {
  return { $abs: { $ifNull: ['$rawAmount', 0] } };
}

function dateBucketExpression(granularity: DashboardGranularity) {
  if (granularity === 'minute') {
    return {
      $dateToString: {
        format: '%Y-%m-%d %H:%M',
        date: '$createdAt',
        timezone: DASHBOARD_TIMEZONE,
      },
    };
  }

  if (granularity === 'hour') {
    return {
      $dateToString: {
        format: '%Y-%m-%d %H:00',
        date: '$createdAt',
        timezone: DASHBOARD_TIMEZONE,
      },
    };
  }

  if (granularity === 'week') {
    return {
      $dateToString: {
        format: '%G-W%V',
        date: '$createdAt',
        timezone: DASHBOARD_TIMEZONE,
      },
    };
  }

  return {
    $dateToString: {
      format: '%Y-%m-%d',
      date: '$createdAt',
      timezone: DASHBOARD_TIMEZONE,
    },
  };
}

function userLabel(user?: UserDoc) {
  if (!user) {
    return '未知用户';
  }

  if (user.username?.trim()) {
    return user.username.trim();
  }
  if (user.name?.trim()) {
    return user.name.trim();
  }
  if (user.email?.trim()) {
    return user.email.split('@')[0] ?? user.email;
  }

  return user._id.toString();
}

async function loadUserLabels(userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter((id) => ObjectId.isValid(id)))];
  if (uniqueIds.length === 0) {
    return new Map<string, string>();
  }

  const { users } = await collections();
  const docs = (await users
    .find(
      { _id: { $in: uniqueIds.map((id) => new ObjectId(id)) } },
      { projection: { username: 1, name: 1, email: 1 } },
    )
    .toArray()) as UserDoc[];

  return new Map(docs.map((doc) => [doc._id.toString(), userLabel(doc)]));
}

function fillTrendDates(
  items: Array<{ date: string; tokens: number }>,
  startDate?: string | null,
  endDate?: string | null,
  granularity: DashboardGranularity = 'day',
) {
  if (!startDate || !endDate || granularity !== 'day') {
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  const map = new Map(items.map((item) => [item.date, item.tokens]));
  const filled: Array<{ date: string; tokens: number }> = [];
  let cursor = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);

  while (compareCalendarDates(cursor, end) <= 0) {
    const key = formatCalendarDate(cursor.year, cursor.month, cursor.day);
    filled.push({ date: key, tokens: map.get(key) ?? 0 });
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
  }

  return filled;
}

function collapseModelUsage(rows: Array<{ _id: string; tokens: number }>) {
  const normalized = rows.map((row) => ({
    model: row._id === 'unknown' ? '其他' : row._id,
    tokens: row.tokens,
  }));

  if (normalized.length <= MAX_MODEL_BARS) {
    return normalized;
  }

  const top = normalized.slice(0, MAX_MODEL_BARS - 1);
  const othersTokens = normalized.slice(MAX_MODEL_BARS - 1).reduce((sum, row) => sum + row.tokens, 0);

  return [...top, { model: '其他', tokens: othersTokens }];
}

export async function getDashboardStats(query: DashboardQuery): Promise<DashboardStats> {
  const granularity: DashboardGranularity =
    query.granularity === 'minute' ||
    query.granularity === 'hour' ||
    query.granularity === 'week' ||
    query.granularity === 'day'
      ? query.granularity
      : 'day';
  const topUsers = Math.min(Math.max(query.topUsers ?? 5, 1), 20);
  const topRatioUsers = Math.min(Math.max(query.topRatioUsers ?? 10, 1), 30);

  const globalMatch = buildTransactionMatch({
    startDate: query.startDate,
    endDate: query.endDate,
    userId: query.userId,
  });

  const trendMatch = buildTransactionMatch({
    startDate: query.startDate,
    endDate: query.endDate,
    userId: query.trendUserId || query.userId,
  });

  const { transactions, conversations } = await collections();
  const tokenSum = tokenAmountExpression();

  const [trendRows, userRows, modelRows, tokenByUserRows, sessionRows] = await Promise.all([
    transactions
      .aggregate<{ _id: string; tokens: number }>([
        { $match: trendMatch },
        { $group: { _id: dateBucketExpression(granularity), tokens: { $sum: tokenSum } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    transactions
      .aggregate<{ _id: ObjectId; tokens: number }>([
        { $match: globalMatch },
        { $group: { _id: '$user', tokens: { $sum: tokenSum } } },
        { $sort: { tokens: -1 } },
      ])
      .toArray(),
    transactions
      .aggregate<{ _id: string; tokens: number }>([
        { $match: globalMatch },
        { $group: { _id: { $ifNull: ['$model', 'unknown'] }, tokens: { $sum: tokenSum } } },
        { $sort: { tokens: -1 } },
      ])
      .toArray(),
    transactions
      .aggregate<{ _id: ObjectId; tokens: number }>([
        { $match: globalMatch },
        { $group: { _id: '$user', tokens: { $sum: tokenSum } } },
      ])
      .toArray(),
    conversations
      .aggregate<{ _id: string; sessions: number }>([
        { $match: buildConversationMatch(query) },
        { $group: { _id: '$user', sessions: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const tokenTrend = fillTrendDates(
    trendRows.map((row) => ({ date: row._id, tokens: row.tokens })),
    query.startDate,
    query.endDate,
    granularity,
  );

  const totalUserTokens = userRows.reduce((sum, row) => sum + row.tokens, 0);
  const topRows = userRows.slice(0, topUsers);
  const othersTokens = userRows.slice(topUsers).reduce((sum, row) => sum + row.tokens, 0);

  const labelIds = [
    ...topRows.map((row) => row._id.toString()),
    ...tokenByUserRows.map((row) => row._id.toString()),
  ];
  const labelMap = await loadUserLabels(labelIds);

  const userDistribution = {
    total: totalUserTokens,
    top: topRows.map((row) => {
      const userId = row._id.toString();
      return {
        userId,
        label: labelMap.get(userId) ?? userId,
        tokens: row.tokens,
        percentage: totalUserTokens > 0 ? (row.tokens / totalUserTokens) * 100 : 0,
      };
    }),
    others:
      othersTokens > 0
        ? {
            tokens: othersTokens,
            percentage: totalUserTokens > 0 ? (othersTokens / totalUserTokens) * 100 : 0,
          }
        : null,
  };

  const modelUsage = collapseModelUsage(modelRows);
  const sessionMap = new Map(sessionRows.map((row) => [row._id, row.sessions]));
  const totalSessions = sessionRows.reduce((sum, row) => sum + row.sessions, 0);

  const tokensPerSession = tokenByUserRows
    .map((row) => {
      const userId = row._id.toString();
      const sessions = sessionMap.get(userId) ?? 0;
      return {
        userId,
        label: labelMap.get(userId) ?? userId,
        tokens: row.tokens,
        sessions,
        ratio: sessions > 0 ? Math.round(row.tokens / sessions) : 0,
      };
    })
    .filter((item) => item.sessions > 0 && item.tokens > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, topRatioUsers);

  return {
    summary: {
      totalTokens: totalUserTokens,
      activeUsers: userRows.filter((row) => row.tokens > 0).length,
      totalSessions,
      modelCount: modelRows.length,
    },
    tokenTrend,
    userDistribution,
    modelUsage,
    tokensPerSession,
  };
}
