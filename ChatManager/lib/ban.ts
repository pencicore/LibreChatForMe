import { clearLoginRateLimitArtifacts } from '@/lib/login-limits';
import { collections } from '@/lib/db';

/** LibreChat CacheKeys.BANS — Keyv 键前缀 */
const BANS_NAMESPACE = 'BANS';

/** LibreChat ViolationTypes.BAN — 封禁缓存命名空间 */
const BAN_CACHE_NAMESPACE = 'ban';

function bansKey(userId: string) {
  return `${BANS_NAMESPACE}:${userId}`;
}

function banCacheKey(userId: string) {
  return `${BAN_CACHE_NAMESPACE}:${userId}`;
}

/** USE_REDIS=true 时 checkBan 写入的缓存键 */
function banCacheRedisKey(userId: string) {
  return `${BAN_CACHE_NAMESPACE}:ban_cache:user:${userId}`;
}

/** 管理端封禁时长，默认约 100 年（实际由手动启用解除） */
export function getAdminBanDurationMs(): number {
  const raw = process.env.CHAT_MANAGER_BAN_DURATION_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 100 * 365.25 * 24 * 60 * 60 * 1000;
}

export type BanRecord = {
  type: string;
  violation_count: number;
  duration: number;
  expiresAt: number;
  /** 供解禁时清理关联的 IP 缓存 */
  user_id?: string;
};

export function buildBanRecord(userId: string, durationMs = getAdminBanDurationMs()): BanRecord {
  return {
    type: 'ban',
    violation_count: 1,
    duration: durationMs,
    expiresAt: Date.now() + durationMs,
    user_id: userId,
  };
}

/**
 * LibreChat Keyv 写入 MongoDB 的 value 格式为序列化后的 { value, expires }，
 * 不能直接存裸 ban 对象，否则 banLogs.get() 会得到 undefined。
 */
function serializeKeyvEntry(record: BanRecord, ttlMs: number): string {
  return JSON.stringify({
    value: record,
    expires: Date.now() + ttlMs,
  });
}

function parseKeyvBanRecord(raw: unknown): BanRecord | null {
  if (raw == null) {
    return null;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { value?: BanRecord; expires?: number };
      if (parsed?.value?.type === 'ban') {
        if (typeof parsed.expires === 'number' && Date.now() > parsed.expires) {
          return null;
        }
        return parsed.value;
      }
    } catch {
      return null;
    }
    return null;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.type === 'ban' && typeof obj.expiresAt !== 'undefined') {
      return obj as BanRecord;
    }
    const wrapped = obj as { value?: BanRecord; expires?: number };
    if (wrapped.value?.type === 'ban') {
      if (typeof wrapped.expires === 'number' && Date.now() > wrapped.expires) {
        return null;
      }
      return wrapped.value;
    }
  }

  return null;
}

/** 判断是否为 LibreChat 按 IP 写入的 ban / BANS 键（非用户 ObjectId） */
function isIpBanKey(key: string): boolean {
  const suffix = key.startsWith('BANS:') ? key.slice(5) : key.startsWith('ban:') ? key.slice(4) : '';

  if (!suffix || key.startsWith('ban:ban_cache:')) {
    return false;
  }

  if (/^[a-f\d]{24}$/i.test(suffix)) {
    return false;
  }

  return suffix.includes('.') || suffix.includes(':');
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 清理共享 IP 上的 ban 缓存（导致「禁一个、全员不能登录」） */
async function clearIpBanCaches(): Promise<number> {
  const { logs } = await collections();
  const candidates = await logs
    .find({ key: { $regex: /^(ban:|BANS:)/ } })
    .project({ key: 1 })
    .toArray();

  const ipKeys = candidates.map((doc) => String(doc.key)).filter(isIpBanKey);
  if (ipKeys.length === 0) {
    return 0;
  }

  const result = await logs.deleteMany({ key: { $in: ipKeys } });
  return result.deletedCount;
}

/** 删除 value 序列化内容中包含该 userId 的封禁记录 */
async function clearBanRecordsReferencingUser(userId: string): Promise<number> {
  const { logs } = await collections();
  const pattern = escapeRegex(userId);
  const result = await logs.deleteMany({
    key: { $regex: /^(ban:|BANS:)/ },
    value: { $regex: pattern },
  });
  return result.deletedCount;
}

async function writeBanRecord(userId: string): Promise<void> {
  const { logs } = await collections();
  const durationMs = getAdminBanDurationMs();
  const banRecord = buildBanRecord(userId, durationMs);
  const key = bansKey(userId);

  await logs.updateOne(
    { key: { $eq: key } },
    {
      $set: {
        key,
        value: serializeKeyvEntry(banRecord, durationMs),
        expiresAt: null,
      },
    },
    { upsert: true },
  );
}

/** 修复旧版 ChatManager 直接写入裸对象的封禁记录 */
export async function repairLegacyBanRecord(userId: string): Promise<boolean> {
  const { logs } = await collections();
  const doc = await logs.findOne({ key: bansKey(userId) });
  if (!doc?.value) {
    return false;
  }

  const record = parseKeyvBanRecord(doc.value);
  if (!record) {
    return false;
  }

  if (typeof doc.value === 'string' || (typeof doc.value === 'object' && 'value' in (doc.value as object))) {
    return false;
  }

  await writeBanRecord(userId);
  return true;
}

/** 将误写入 keyv 集合的封禁迁移到 logs，并修复旧 value 格式 */
export async function migrateBansFromKeyvCollection(): Promise<number> {
  const { logs, legacyKeyv } = await collections();
  const docs = await legacyKeyv.find({ key: { $regex: '^BANS:' } }).toArray();
  let migrated = 0;

  for (const doc of docs) {
    const userId = String(doc.key).replace(/^BANS:/, '');
    if (!userId) {
      continue;
    }

    const record = parseKeyvBanRecord(doc.value);
    const durationMs = record?.duration ?? getAdminBanDurationMs();
    const banRecord = record ?? buildBanRecord(userId, durationMs);
    const key = bansKey(userId);

    await logs.updateOne(
      { key: { $eq: key } },
      {
        $set: {
          key,
          value:
            typeof doc.value === 'string'
              ? doc.value
              : serializeKeyvEntry(banRecord, durationMs),
          expiresAt: null,
        },
      },
      { upsert: true },
    );
    await legacyKeyv.deleteOne({ _id: doc._id });
    migrated += 1;
  }

  return migrated;
}

/** 扫描并修复所有旧格式封禁记录 */
export async function repairAllLegacyBanRecords(): Promise<number> {
  const migrated = await migrateBansFromKeyvCollection();
  const ipCleared = await clearIpBanCaches();
  const { logs } = await collections();
  const docs = await logs.find({ key: { $regex: '^BANS:' } }).toArray();
  let fixed = migrated + ipCleared;

  for (const doc of docs) {
    const userId = String(doc.key).replace(/^BANS:/, '');
    if (!userId) {
      continue;
    }

    const isLegacy =
      doc.value &&
      typeof doc.value === 'object' &&
      (doc.value as BanRecord).type === 'ban' &&
      !('value' in (doc.value as object));

    if (isLegacy) {
      await writeBanRecord(userId);
      fixed += 1;
    }
  }

  return fixed;
}

/**
 * 写入 LibreChat keyv 封禁记录，使 checkBan 拦截聊天与登录。
 * 与 LibreChat config/ban-user.js → banViolation 写入格式一致。
 */
export async function banUser(userId: string): Promise<void> {
  await repairLegacyBanRecord(userId);
  await writeBanRecord(userId);
}

/**
 * 解除封禁并清理 checkBan 写入的缓存。
 * 必须清理 IP 级缓存（如 ban:::1），否则同 IP 的其他用户仍无法登录。
 */
export async function unbanUser(userId: string): Promise<void> {
  const { logs } = await collections();

  await logs.deleteMany({
    key: { $in: [bansKey(userId), banCacheKey(userId), banCacheRedisKey(userId)] },
  });

  await clearBanRecordsReferencingUser(userId);
  await clearIpBanCaches();
  await clearLoginRateLimitArtifacts();
}

/** 紧急修复：清除所有 IP 级封禁缓存（不影响按用户 ID 的 BANS 记录） */
export async function clearAllIpBanCaches(): Promise<number> {
  return clearIpBanCaches();
}

export async function isUserBanned(userId: string): Promise<boolean> {
  const { logs } = await collections();
  const doc = await logs.findOne({ key: bansKey(userId) }, { projection: { value: 1 } });
  const record = parseKeyvBanRecord(doc?.value);
  if (!record) {
    return false;
  }

  if (!record.expiresAt || Number.isNaN(Number(record.expiresAt))) {
    return true;
  }

  return Number(record.expiresAt) > Date.now();
}
