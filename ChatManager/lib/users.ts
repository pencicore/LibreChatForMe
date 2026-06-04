import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ObjectId, type Document } from 'mongodb';
import { banUser, unbanUser } from '@/lib/ban';
import { collections } from '@/lib/db';
import { formatUserId as formatDisplayUserId } from '@/lib/format';
import { escapeRegex, jsonDate, startOfToday } from '@/lib/http';
import type {
  BulkCreateInput,
  BulkCreatePreview,
  BulkCreateResult,
  LibreChatUser,
  UserStats,
} from '@/types/librechat';

export type BulkCreateBody = {
  prefix?: string;
  domain?: string;
  count?: number;
  startIndex?: number;
  password?: string;
  randomPassword?: boolean;
  namePrefix?: string;
  role?: string;
  emailVerified?: boolean;
  tenantId?: string;
};

const RANDOM_PASSWORD_CHARS = {
  lower: 'abcdefghjkmnpqrstuvwxyz',
  upper: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%&*',
};

export function generateRandomPassword(length = 12): string {
  const pools = [
    RANDOM_PASSWORD_CHARS.lower,
    RANDOM_PASSWORD_CHARS.upper,
    RANDOM_PASSWORD_CHARS.digit,
    RANDOM_PASSWORD_CHARS.symbol,
  ];
  const allChars = pools.join('');
  const bytes = randomBytes(length);
  const required = pools.map((pool) => pool[bytes[0] % pool.length]);
  const rest = Array.from({ length: length - required.length }, (_, index) => {
    const offset = index + 1;
    return allChars[bytes[offset % bytes.length] % allChars.length];
  });

  const chars = [...required, ...rest];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index % bytes.length] % (index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }

  return chars.join('');
}

export function parseBulkCreateInput(body: BulkCreateBody): BulkCreateInput {
  const prefix = body.prefix?.trim().toLowerCase() || 'contestant';
  const domain = body.domain?.trim().toLowerCase() || 'competition.local';
  const count = Number(body.count);
  const startIndex = Number(body.startIndex || 1);
  const randomPassword = body.randomPassword === true;
  const password = body.password?.trim() ?? '';

  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('count must be an integer between 1 and 1000');
  }

  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error('startIndex must be a positive integer');
  }

  if (!randomPassword && (!password || password.length < 8 || password.length > 128)) {
    throw new Error('password must be 8-128 characters');
  }

  return {
    prefix,
    domain,
    count,
    startIndex,
    password: randomPassword ? '' : password,
    randomPassword,
    namePrefix: body.namePrefix?.trim() || '选手 ',
    role: body.role?.trim() || 'USER',
    emailVerified: body.emailVerified ?? true,
    tenantId: body.tenantId?.trim() || undefined,
  };
}

export type CompetitionUserDraft = {
  name: string;
  username: string;
  email: string;
};

export function buildCompetitionUserDrafts(input: BulkCreateInput): CompetitionUserDraft[] {
  return Array.from({ length: input.count }, (_, index) => {
    const serial = input.startIndex + index;
    const username = `${input.prefix}${serial}`;

    return {
      name: `${input.namePrefix}${serial}`,
      username,
      email: `${username}@${input.domain}`.toLowerCase(),
    };
  });
}

async function findExistingEmails(emails: string[]) {
  if (emails.length === 0) {
    return new Set<string>();
  }

  const { users } = await collections();
  const existing = await users.find({ email: { $in: emails } }, { projection: { email: 1 } }).toArray();
  return new Set(existing.map((doc) => String(doc.email)));
}

export async function previewCompetitionUsers(input: BulkCreateInput): Promise<BulkCreatePreview> {
  const drafts = buildCompetitionUserDrafts(input);
  const existingEmails = await findExistingEmails(drafts.map((doc) => doc.email));

  const items = drafts.map((doc) => ({
    email: doc.email,
    username: doc.username,
    name: doc.name,
    status: existingEmails.has(doc.email) ? ('duplicate' as const) : ('new' as const),
  }));

  const duplicateCount = items.filter((item) => item.status === 'duplicate').length;

  return {
    items,
    summary: {
      total: items.length,
      newCount: items.length - duplicateCount,
      duplicateCount,
    },
  };
}

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

export function userAuditLabel(user: {
  email?: string;
  username?: string;
  name?: string;
}) {
  return user.email || user.username || user.name || '该账户';
}

export async function getUserAuditLabels(ids: string[]) {
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

  if (objectIds.length === 0) {
    return [];
  }

  const { users } = await collections();
  const docs = await users
    .find(
      { _id: { $in: objectIds } },
      { projection: { email: 1, username: 1, name: 1 } },
    )
    .toArray();

  const labelMap = new Map(
    docs.map((doc) => [
      doc._id.toString(),
      userAuditLabel({
        email: doc.email as string | undefined,
        username: doc.username as string | undefined,
        name: doc.name as string | undefined,
      }),
    ]),
  );

  return ids.map((id) => labelMap.get(id) ?? '该账户');
}

export async function getUserAuditLabel(id: string) {
  const [label] = await getUserAuditLabels([id]);
  return label ?? '该账户';
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

export async function createCompetitionUsers(input: BulkCreateInput): Promise<BulkCreateResult> {
  const { users } = await collections();
  const now = new Date();
  const drafts = buildCompetitionUserDrafts(input);

  if (drafts.length === 0) {
    return { created: [], duplicates: [] };
  }

  const existingEmails = await findExistingEmails(drafts.map((doc) => doc.email));
  const creatableDrafts = drafts.filter((draft) => !existingEmails.has(draft.email));

  if (creatableDrafts.length === 0) {
    return {
      created: [],
      duplicates: drafts
        .filter((draft) => existingEmails.has(draft.email))
        .map((draft) => ({ email: draft.email, username: draft.username })),
    };
  }

  const plainPasswords = input.randomPassword
    ? creatableDrafts.map(() => generateRandomPassword())
    : creatableDrafts.map(() => input.password);

  const passwordHashes = input.randomPassword
    ? await Promise.all(plainPasswords.map((password) => bcrypt.hash(password, 10)))
    : [await bcrypt.hash(input.password, 10)];

  const docs = creatableDrafts.map((draft, index) => ({
    name: draft.name,
    username: draft.username,
    email: draft.email,
    emailVerified: input.emailVerified,
    disabled: false,
    password: input.randomPassword ? passwordHashes[index] : passwordHashes[0],
    provider: 'local',
    role: input.role,
    termsAccepted: true,
    personalization: { memories: true },
    favorites: [],
    refreshToken: [],
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    createdAt: now,
    updatedAt: now,
  }));

  await users.insertMany(docs, { ordered: false });

  return {
    created: creatableDrafts.map((draft, index) => ({
      email: draft.email,
      username: draft.username,
      name: draft.name,
      password: plainPasswords[index],
    })),
    duplicates: drafts
      .filter((draft) => existingEmails.has(draft.email))
      .map((draft) => ({ email: draft.email, username: draft.username })),
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
      await Promise.all([
        banUser(objectId.toString()),
        sessions.deleteMany({ user: objectId }),
      ]);
      payload.refreshToken = [];
    } else {
      await unbanUser(objectId.toString());
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
    unbanUser(userId),
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
