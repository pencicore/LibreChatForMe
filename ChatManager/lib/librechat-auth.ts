import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { hasAdminAccess } from '@/lib/admin-access';
import { collections } from '@/lib/db';

const DEFAULT_SESSION_EXPIRY = 15 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name?: string;
  username?: string;
  role?: string;
};

type RawUser = {
  _id: ObjectId;
  email: string;
  name?: string;
  username?: string;
  role?: string;
  tenantId?: string;
  provider?: string;
  password?: string;
  emailVerified?: boolean;
  disabled?: boolean;
};

type LoginResult =
  | { ok: true; token: string; user: SessionUser; expiresInMs: number }
  | { ok: false; status: number; message: string; twoFA?: boolean };

function sessionExpiryMs() {
  const configured = Number(process.env.SESSION_EXPIRY);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_EXPIRY;
}

function toSessionUser(user: RawUser): SessionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}

export function mintSessionToken(user: RawUser): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error('JWT_SECRET is required for session tokens');
  }

  const expiresInMs = sessionExpiryMs();

  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      provider: user.provider,
    },
    secret,
    { expiresIn: Math.floor(expiresInMs / 1000) },
  );
}

async function findUserByEmail(email: string): Promise<RawUser | null> {
  const { users } = await collections();
  const doc = await users.findOne({ email: email.trim() });

  if (!doc) {
    return null;
  }

  return doc as RawUser;
}

export async function authenticateLocalAdmin(
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await findUserByEmail(email);

  if (!user?.password) {
    return { ok: false, status: 401, message: '邮箱或密码错误' };
  }

  if (user.disabled) {
    return { ok: false, status: 403, message: '账户已禁用' };
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return { ok: false, status: 401, message: '邮箱或密码错误' };
  }

  const unverifiedAllowed = process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN === 'true';

  if (!user.emailVerified && !unverifiedAllowed) {
    return { ok: false, status: 403, message: '邮箱尚未验证，请先在 LibreChat 完成验证' };
  }

  const isAdmin = await hasAdminAccess(user._id.toString(), user.role, user.tenantId);

  if (!isAdmin) {
    return { ok: false, status: 403, message: '该账户没有管理员权限' };
  }

  const token = mintSessionToken(user);

  return {
    ok: true,
    token,
    user: toSessionUser(user),
    expiresInMs: sessionExpiryMs(),
  };
}

export async function loginViaLibreChatApi(
  email: string,
  password: string,
): Promise<LoginResult | null> {
  const baseUrl = process.env.LIBRECHAT_API_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/admin/login/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return null;
  }

  const data = (await response.json().catch(() => ({}))) as {
    token?: string;
    user?: SessionUser & { id?: string; _id?: string };
    message?: string;
    twoFAPending?: boolean;
  };

  if (data.twoFAPending) {
    return {
      ok: false,
      status: 403,
      message: '该账户已启用两步验证，请先在 LibreChat 管理后台完成登录',
      twoFA: true,
    };
  }

  if (!response.ok || !data.token || !data.user) {
    const message =
      typeof data.message === 'string' && data.message.length > 0
        ? data.message
        : '邮箱或密码错误';

    return { ok: false, status: response.status || 401, message };
  }

  const userId = data.user.id ?? data.user._id;

  if (!userId) {
    return { ok: false, status: 500, message: '登录响应无效' };
  }

  return {
    ok: true,
    token: data.token,
    user: {
      id: String(userId),
      email: data.user.email,
      name: data.user.name,
      username: data.user.username,
      role: data.user.role,
    },
    expiresInMs: sessionExpiryMs(),
  };
}

export async function loginAdmin(email: string, password: string): Promise<LoginResult> {
  const viaApi = await loginViaLibreChatApi(email, password);

  if (viaApi) {
    return viaApi;
  }

  return authenticateLocalAdmin(email, password);
}
