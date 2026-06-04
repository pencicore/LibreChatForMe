import type { SessionUser } from '@/lib/librechat-auth';
import { getSessionUser } from '@/lib/auth';
import { collections } from '@/lib/db';
import { escapeRegex, jsonDate } from '@/lib/http';

export type AdminOperationAction =
  | 'ADMIN_LOGIN'
  | 'USER_BULK_CREATE'
  | 'USER_DISABLE'
  | 'USER_ENABLE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'CONVERSATION_DELETE'
  | 'CONVERSATION_ARCHIVE'
  | 'CONVERSATION_UNARCHIVE';

export type AdminOperationTargetType = 'auth' | 'user' | 'conversation';

type LogAdminOperationInput = {
  request: Request;
} & AdminOperationDescriptionInput;

type AdminOperationDescriptionInput = {
  admin: SessionUser;
  action: AdminOperationAction;
  targetType: AdminOperationTargetType;
  targetId?: string;
  targetIds?: string[];
  details?: Record<string, unknown>;
  description?: string;
};

export type AdminOperationLogItem = {
  _id: string;
  action: AdminOperationAction | string;
  actionLabel: string;
  module: string;
  moduleLabel: string;
  status: 'success' | 'failed';
  description: string;
  admin: {
    id?: string;
    email?: string;
    name?: string;
    username?: string;
    role?: string;
  };
  targetType: string;
  targetId?: string;
  targetIds?: string[];
  details: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt?: string;
};

const USER_ACTIONS = [
  'ADMIN_LOGIN',
  'USER_BULK_CREATE',
  'USER_DISABLE',
  'USER_ENABLE',
  'USER_UPDATE',
  'USER_DELETE',
];

const CONVERSATION_ACTIONS = [
  'CONVERSATION_DELETE',
  'CONVERSATION_ARCHIVE',
  'CONVERSATION_UNARCHIVE',
];

const KNOWN_ACTIONS = [...USER_ACTIONS, ...CONVERSATION_ACTIONS];

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    undefined
  );
}

function adminLabel(admin: SessionUser) {
  return admin.email || admin.username || admin.name || admin.id;
}

function countTargets(input: AdminOperationDescriptionInput) {
  return input.targetIds?.length ?? (input.targetId ? 1 : 0);
}

function detailNumber(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function detailText(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function detailTextArray(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function formatReadableList(items: string[], total: number, fallback: string) {
  if (items.length === 0) {
    return fallback;
  }

  const visible = items.slice(0, 5);
  const suffix = total > visible.length ? `等 ${total} 个` : '';
  return `${visible.join('、')}${suffix}`;
}

function accountLabel(details: Record<string, unknown> | undefined) {
  return (
    detailText(details, 'accountLabel') ||
    detailText(details, 'email') ||
    detailText(details, 'username') ||
    detailText(details, 'name') ||
    '该账户'
  );
}

function accountListLabel(details: Record<string, unknown> | undefined, total: number) {
  return formatReadableList(detailTextArray(details, 'accountLabels'), total, '所选账户');
}

function conversationLabel(details: Record<string, unknown> | undefined) {
  return detailText(details, 'conversationTitle') || detailText(details, 'title') || '指定会话';
}

export function buildAdminOperationDescription(input: AdminOperationDescriptionInput) {
  const admin = adminLabel(input.admin);
  const targetCount = countTargets(input);
  const details = input.details;
  const target = targetCount > 1 ? accountListLabel(details, targetCount) : accountLabel(details);

  switch (input.action) {
    case 'ADMIN_LOGIN':
      return `管理员 ${admin} 登录 ChatManager`;
    case 'USER_BULK_CREATE': {
      const createdCount = detailNumber(details, 'createdCount');
      const duplicateCount = detailNumber(details, 'duplicateCount');
      const skippedCount = detailNumber(details, 'skippedCount');
      const source = detailText(details, 'source') === 'csv_import' ? '通过 CSV 导入' : '通过批量创建';
      const suffix =
        skippedCount > 0
          ? `，跳过 ${skippedCount} 个账户`
          : duplicateCount > 0
            ? `，重复 ${duplicateCount} 个账户`
            : '';
      return `管理员 ${admin} ${source}创建了 ${createdCount} 个账户${suffix}`;
    }
    case 'USER_DISABLE':
      return `管理员 ${admin} 禁用了账户 ${target}`;
    case 'USER_ENABLE':
      return `管理员 ${admin} 解除了账户 ${target} 的禁用`;
    case 'USER_UPDATE': {
      const fields = Array.isArray(details?.changedFields)
        ? details.changedFields.filter((field): field is string => typeof field === 'string')
        : [];
      const fieldText = fields.length > 0 ? `，修改字段：${fields.join('、')}` : '';
      return `管理员 ${admin} 修改了账户 ${target}${fieldText}`;
    }
    case 'USER_DELETE':
      return `管理员 ${admin} 删除了账户 ${target}`;
    case 'CONVERSATION_DELETE':
      return `管理员 ${admin} 删除了会话「${conversationLabel(details)}」`;
    case 'CONVERSATION_ARCHIVE':
      return `管理员 ${admin} 归档了会话「${conversationLabel(details)}」`;
    case 'CONVERSATION_UNARCHIVE':
      return `管理员 ${admin} 取消归档了会话「${conversationLabel(details)}」`;
    default:
      return `管理员 ${admin} 执行了操作 ${input.action}`;
  }
}

export function adminOperationActionLabel(action: string) {
  const labels: Record<string, string> = {
    ADMIN_LOGIN: '登录',
    USER_BULK_CREATE: '创建用户',
    USER_DISABLE: '禁用用户',
    USER_ENABLE: '解除禁用',
    USER_UPDATE: '更新用户',
    USER_DELETE: '删除用户',
    CONVERSATION_DELETE: '删除会话',
    CONVERSATION_ARCHIVE: '归档会话',
    CONVERSATION_UNARCHIVE: '取消归档',
  };

  return labels[action] ?? action;
}

export function adminOperationModuleLabel(action: string) {
  if (action === 'ADMIN_LOGIN') {
    return { module: 'auth', label: '账户管理' };
  }
  if (action.startsWith('USER_')) {
    return { module: 'accounts', label: '账户管理' };
  }
  if (action.startsWith('CONVERSATION_')) {
    return { module: 'chat-records', label: '聊天记录' };
  }

  return { module: 'system', label: '系统' };
}

let indexesReady: Promise<void> | null = null;

async function ensureAdminOperationLogIndexes() {
  if (!indexesReady) {
    indexesReady = collections().then(async ({ adminOperationLogs }) => {
      await Promise.all([
        adminOperationLogs.createIndex({ createdAt: -1 }),
        adminOperationLogs.createIndex({ action: 1, createdAt: -1 }),
        adminOperationLogs.createIndex({ 'admin.id': 1, createdAt: -1 }),
        adminOperationLogs.createIndex({ targetType: 1, targetId: 1, createdAt: -1 }),
      ]);
    });
  }

  await indexesReady;
}

export async function logAdminOperation(input: LogAdminOperationInput) {
  const { adminOperationLogs } = await collections();
  const now = new Date();

  await ensureAdminOperationLogIndexes();
  const description = input.description ?? buildAdminOperationDescription(input);
  await adminOperationLogs.insertOne({
    action: input.action,
    description,
    status: 'success',
    targetType: input.targetType,
    targetId: input.targetId,
    targetIds: input.targetIds,
    admin: {
      id: input.admin.id,
      email: input.admin.email,
      name: input.admin.name,
      username: input.admin.username,
      role: input.admin.role,
    },
    details: input.details ?? {},
    ip: getClientIp(input.request),
    userAgent: input.request.headers.get('user-agent') ?? undefined,
    createdAt: now,
    updatedAt: now,
  });
}

function mapAdminOperationLog(doc: Record<string, unknown>): AdminOperationLogItem {
  const action = String(doc.action ?? '');
  const moduleInfo = adminOperationModuleLabel(action);
  const details =
    doc.details && typeof doc.details === 'object' && !Array.isArray(doc.details)
      ? (doc.details as Record<string, unknown>)
      : {};
  const admin =
    doc.admin && typeof doc.admin === 'object' && !Array.isArray(doc.admin)
      ? (doc.admin as AdminOperationLogItem['admin'])
      : {};
  const targetIds = Array.isArray(doc.targetIds)
    ? doc.targetIds.filter((item): item is string => typeof item === 'string')
    : undefined;
  const descriptionAdmin: SessionUser = {
    id: admin.id ?? '',
    email: admin.email || admin.username || admin.name || 'Admin',
    name: admin.name,
    username: admin.username,
    role: admin.role,
  };
  const description = buildAdminOperationDescription({
    admin: descriptionAdmin,
    action: action as AdminOperationAction,
    targetType: String(doc.targetType ?? '') as AdminOperationTargetType,
    targetId: typeof doc.targetId === 'string' ? doc.targetId : undefined,
    targetIds,
    details,
  });

  return {
    _id: String(doc._id),
    action,
    actionLabel: adminOperationActionLabel(action),
    module: moduleInfo.module,
    moduleLabel: moduleInfo.label,
    status: doc.status === 'failed' ? 'failed' : 'success',
    description,
    admin,
    targetType: String(doc.targetType ?? ''),
    targetId: typeof doc.targetId === 'string' ? doc.targetId : undefined,
    targetIds,
    details,
    ip: typeof doc.ip === 'string' ? doc.ip : undefined,
    userAgent: typeof doc.userAgent === 'string' ? doc.userAgent : undefined,
    createdAt: jsonDate(doc.createdAt),
  };
}

function buildOperationLogFilter(options: {
  q?: string | null;
  module?: string | null;
  action?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const filter: Record<string, unknown> = {};

  if (options.q?.trim()) {
    const pattern = new RegExp(escapeRegex(options.q.trim()), 'i');
    filter.$or = [
      { description: pattern },
      { 'admin.email': pattern },
      { 'admin.username': pattern },
      { 'admin.name': pattern },
      { ip: pattern },
      { action: pattern },
    ];
  }

  if (options.module && options.module !== 'ALL') {
    if (options.module === 'accounts') {
      filter.action = { $in: USER_ACTIONS };
    } else if (options.module === 'chat-records') {
      filter.action = { $in: CONVERSATION_ACTIONS };
    } else if (options.module === 'system') {
      filter.action = { $nin: KNOWN_ACTIONS };
    }
  }

  if (options.action && options.action !== 'ALL') {
    filter.action = options.action;
  }

  if (options.status && options.status !== 'ALL') {
    filter.status = options.status === 'success' ? { $ne: 'failed' } : options.status;
  }

  if (options.startDate || options.endDate) {
    const range: Record<string, Date> = {};
    if (options.startDate) {
      range.$gte = new Date(`${options.startDate}T00:00:00`);
    }
    if (options.endDate) {
      range.$lte = new Date(`${options.endDate}T23:59:59`);
    }
    filter.createdAt = range;
  }

  return filter;
}

export async function listAdminOperationLogs(options: {
  page: number;
  limit: number;
  q?: string | null;
  module?: string | null;
  action?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const { adminOperationLogs } = await collections();
  const filter = buildOperationLogFilter(options);
  const skip = (options.page - 1) * options.limit;
  const [items, total] = await Promise.all([
    adminOperationLogs.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).toArray(),
    adminOperationLogs.countDocuments(filter),
  ]);

  return {
    logs: items.map((item) => mapAdminOperationLog(item)),
    total,
  };
}

export function operationLogsToCsv(items: AdminOperationLogItem[]) {
  const header = ['time', 'admin', 'module', 'action', 'description', 'status', 'ip'];
  const rows = items.map((item) => [
    item.createdAt ?? '',
    item.admin.email || item.admin.username || item.admin.name || '',
    item.moduleLabel,
    item.actionLabel,
    item.description,
    item.status === 'success' ? '成功' : '失败',
    item.ip ?? '',
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function getAdminForOperationLog(request: Request): SessionUser {
  return (
    getSessionUser(request) ?? {
      id: 'auth-disabled',
      email: 'auth-disabled',
      name: 'Auth Disabled',
      role: 'ADMIN',
    }
  );
}

export function redactBulkCreateDetails(details: {
  created?: Array<{ email: string; username: string; name?: string }>;
  duplicates?: Array<{ email: string; username: string }>;
}) {
  return {
    createdCount: details.created?.length ?? 0,
    duplicateCount: details.duplicates?.length ?? 0,
    createdSample: details.created?.slice(0, 20).map(({ email, username, name }) => ({
      email,
      username,
      name,
    })) ?? [],
    duplicateSample: details.duplicates?.slice(0, 20) ?? [],
  };
}
