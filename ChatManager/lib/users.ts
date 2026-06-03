import bcrypt from 'bcryptjs';
import { ObjectId, type Document } from 'mongodb';
import { collections } from '@/lib/db';
import { formatUserId as formatDisplayUserId } from '@/lib/format';
import { escapeRegex, jsonDate, startOfToday } from '@/lib/http';
import type { BulkCreateResult, LibreChatUser, UserStats } from '@/types/librechat';

type RawUser = {
  _id: ObjectId;
  name?: string;
  username?: string;
  email: string;
  emailVerified?: boolean;
  disabled?: boolean;
  provider?: string;
  role?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

const USER_PROJECTION = {
  password: 0,
  refreshToken: 0,
  totpSecret: 0,
  backupCodes: 0,
  pendingTotpSecret: 0,
  pendingBackupCodes: 0,
};

export function formatUserId(id: ObjectId | string) {
  const raw = typeof id === 'string' ? id : id.toString();
  return formatDisplayUserId(raw);
}

export function buildUserSearch(
  query: string | null,
  role: string | null,
  status: string | null,
  dateRange: string | null,
) {
  const filter: Record<string, unknown> = {};
  const trimmedQuery = query?.trim();

  if (trimmedQuery) {
    const pattern = new RegExp(escapeRegex(trimmedQuery), 'i');
    const or: Record<string, unknown>[] = [
      { email: pattern },
      { username: pattern },
      { name: pattern },
    ];

    if (ObjectId.isValid(trimmedQuery)) {
      or.push({ _id: new ObjectId(trimmedQuery) });
    }

    filter.$or = or;
  }

  if (role && role !== 'ALL') {
    filter.role = role;
  }

  if (status === 'ACTIVE') {
    filter.disabled = { $ne: true };
    filter.emailVerified = true;
  } else if (status === 'DISABLED') {
    filter.$or = [{ disabled: true }, { emailVerified: false }];
  } else if (status === 'UNVERIFIED') {
    filter.emailVerified = false;
    filter.disabled = { $ne: true };
  }

  if (dateRange === 'TODAY') {
    filter.createdAt = { $gte: startOfToday() };
  } else if (dateRange === 'WEEK') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    filter.createdAt = { $gte: weekAgo };
  } else if (dateRange === 'MONTH') {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    filter.createdAt = { $gte: monthAgo };
  }

  return filter;
}

export function mapUser(user: RawUser, extras?: { lastLoginAt?: Date; messageCount?: number }): LibreChatUser {
  return {
    _id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    disabled: user.disabled === true,
    provider: user.provider,
    role: user.role,
    tenantId: user.tenantId,
    createdAt: jsonDate(user.createdAt),
    updatedAt: jsonDate(user.updatedAt),
    lastLoginAt: jsonDate(extras?.lastLoginAt),
    messageCount: extras?.messageCount ?? 0,
  };
}

export async function getUserStats(): Promise<UserStats> {
  const { users } = await collections();
  const today = startOfToday();

  const [total, active, newToday, disabled, admins] = await Promise.all([
    users.countDocuments(),
    users.countDocuments({ disabled: { $ne: true }, emailVerified: true }),
    users.countDocuments({ createdAt: { $gte: today } }),
    users.countDocuments({ $or: [{ disabled: true }, { emailVerified: false }] }),
    users.countDocuments({ role: 'ADMIN' }),
  ]);

  return {
    total,
    active,
    newToday,
    disabled,
    admins,
    activeRate: total > 0 ? Math.round((active / total) * 1000) / 10 : 0,
    adminRate: total > 0 ? Math.round((admins / total) * 10000) / 100 : 0,
  };
}

async function attachUserExtras(items: RawUser[]) {
  if (items.length === 0) {
    return [];
  }

  const { messages, sessions } = await collections();
  const ids = items.map((item) => item._id);
  const idStrings = ids.map((id) => id.toString());

  const [messageCounts, sessionRows] = await Promise.all([
    messages
      .aggregate<{ _id: string; count: number }>([
        { $match: { user: { $in: idStrings } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ])
      .toArray(),
    sessions
      .aggregate<{ _id: ObjectId; lastLoginAt: Date }>([
        { $match: { user: { $in: ids } } },
        { $group: { _id: '$user', lastLoginAt: { $max: '$expiration' } } },
      ])
      .toArray(),
  ]);

  const messageMap = new Map(messageCounts.map((row) => [row._id, row.count]));
  const sessionMap = new Map(sessionRows.map((row) => [row._id.toString(), row.lastLoginAt]));

  return items.map((item) =>
    mapUser(item, {
      messageCount: messageMap.get(item._id.toString()) ?? 0,
      lastLoginAt: sessionMap.get(item._id.toString()),
    }),
  );
}

export async function listUsers(options: {
  filter: Record<string, unknown>;
  page: number;
  limit: number;
}) {
  const { users } = await collections();
  const skip = (options.page - 1) * options.limit;

  const [items, total, stats] = await Promise.all([
    users
      .find(options.filter, { projection: USER_PROJECTION })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(options.limit)
      .toArray(),
    users.countDocuments(options.filter),
    getUserStats(),
  ]);

  return {
    users: await attachUserExtras(items as RawUser[]),
    total,
    stats,
  };
}

export async function createCompetitionUsers(input: {
  prefix: string;
  domain: string;
  count: number;
  startIndex: number;
  password: string;
  namePrefix: string;
  role: string;
  emailVerified: boolean;
  tenantId?: string;
}): Promise<BulkCreateResult> {
  const { users } = await collections();
  const now = new Date();
  const passwordHash = await bcrypt.hash(input.password, 10);

  const docs = Array.from({ length: input.count }, (_, index) => {
    const serial = input.startIndex + index;
    const username = `${input.prefix}${serial}`;

    return {
      name: `${input.namePrefix}${serial}`,
      username,
      email: `${username}@${input.domain}`.toLowerCase(),
      emailVerified: input.emailVerified,
      disabled: false,
      password: passwordHash,
      provider: 'local',
      role: input.role,
      termsAccepted: true,
      personalization: { memories: true },
      favorites: [],
      refreshToken: [],
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      createdAt: now,
      updatedAt: now,
    };
  });

  if (docs.length === 0) {
    return { created: [], duplicates: [] };
  }

  const emails = docs.map((doc) => doc.email);
  const existing = await users.find({ email: { $in: emails } }, { projection: { email: 1 } }).toArray();
  const existingEmails = new Set(existing.map((doc) => String(doc.email)));
  const creatable = docs.filter((doc) => !existingEmails.has(doc.email));

  if (creatable.length > 0) {
    await users.insertMany(creatable, { ordered: false });
  }

  return {
    created: creatable.map((doc) => ({
      email: doc.email,
      username: doc.username,
      name: doc.name,
      password: input.password,
    })),
    duplicates: docs
      .filter((doc) => existingEmails.has(doc.email))
      .map((doc) => ({ email: doc.email, username: doc.username })),
  };
}

export async function updateUserById(
  id: string,
  update: Partial<{
    name: string;
    username: string;
    role: string;
    emailVerified: boolean;
    disabled: boolean;
    tenantId: string;
  }>,
) {
  const { users, sessions } = await collections();
  const objectId = new ObjectId(id);
  const payload: Record<string, unknown> = { updatedAt: new Date() };

  for (const field of ['name', 'username', 'role', 'tenantId'] as const) {
    if (typeof update[field] === 'string') {
      payload[field] = update[field]?.trim();
    }
  }

  if (typeof update.emailVerified === 'boolean') {
    payload.emailVerified = update.emailVerified;
  }

  if (typeof update.disabled === 'boolean') {
    payload.disabled = update.disabled;
    if (update.disabled) {
      await sessions.deleteMany({ user: objectId });
      payload.refreshToken = [];
    }
  }

  const result = await users.findOneAndUpdate(
    { _id: objectId },
    { $set: payload },
    { returnDocument: 'after', projection: USER_PROJECTION },
  );

  if (!result) {
    return null;
  }

  const [mapped] = await attachUserExtras([result as RawUser]);
  return mapped;
}

export async function deleteUserById(id: string) {
  const { users, messages, sessions } = await collections();
  const objectId = new ObjectId(id);
  const userId = objectId.toString();

  await Promise.all([
    messages.deleteMany({ user: userId }),
    sessions.deleteMany({ user: objectId }),
    users.deleteOne({ _id: objectId }),
  ]);

  return true;
}

export async function deleteUsersByIds(ids: string[]) {
  await Promise.all(ids.filter((id) => ObjectId.isValid(id)).map((id) => deleteUserById(id)));
}

export function usersToCsv(users: LibreChatUser[]) {
  const header = ['email', 'username', 'name', 'role', 'status', 'userId', 'createdAt', 'messageCount'];
  const rows = users.map((user) => [
    user.email,
    user.username ?? '',
    user.name ?? '',
    user.role ?? 'USER',
    user.disabled || !user.emailVerified ? 'disabled' : 'active',
    formatUserId(user._id),
    user.createdAt ?? '',
    String(user.messageCount ?? 0),
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export async function importUsersFromCsv(content: string, defaultPassword: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const header = lines[0].split(',').map((cell) => cell.replace(/^"|"$/g, '').trim().toLowerCase());
  const emailIndex = header.indexOf('email');
  const usernameIndex = header.indexOf('username');
  const nameIndex = header.indexOf('name');
  const roleIndex = header.indexOf('role');
  const passwordIndex = header.indexOf('password');

  const dataLines = header.includes('email') ? lines.slice(1) : lines;
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const { users } = await collections();
  const now = new Date();
  let created = 0;
  let skipped = 0;

  for (const line of dataLines) {
    const cells = line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim());
    const email = cells[emailIndex >= 0 ? emailIndex : 0];
    const username = cells[usernameIndex >= 0 ? usernameIndex : 1] || email.split('@')[0];
    const name = cells[nameIndex >= 0 ? nameIndex : 2] || username;
    const role = cells[roleIndex >= 0 ? roleIndex : 3] || 'USER';
    const password = cells[passwordIndex >= 0 ? passwordIndex : -1];

    if (!email || !email.includes('@')) {
      skipped += 1;
      continue;
    }

    const exists = await users.findOne({ email: email.toLowerCase() }, { projection: { _id: 1 } });
    if (exists) {
      skipped += 1;
      continue;
    }

    await users.insertOne({
      name,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      emailVerified: true,
      disabled: false,
      password: password ? await bcrypt.hash(password, 10) : passwordHash,
      provider: 'local',
      role: role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
      termsAccepted: true,
      personalization: { memories: true },
      favorites: [],
      refreshToken: [],
      createdAt: now,
      updatedAt: now,
    } as Document);
    created += 1;
  }

  return { created, skipped };
}
