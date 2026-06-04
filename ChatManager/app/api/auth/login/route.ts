import { NextResponse } from 'next/server';
import { logAdminOperation } from '@/lib/admin-operation-logs';
import { isAuthRequired } from '@/lib/auth';
import { loginAdmin } from '@/lib/librechat-auth';
import { clearSessionCookieOptions, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

export async function POST(request: Request) {
  if (!isAuthRequired()) {
    return NextResponse.json(
      { error: '未配置 JWT_SECRET，登录功能未启用' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;

  const email = body?.email?.trim();
  const password = body?.password ?? '';

  if (!email || !password) {
    return NextResponse.json({ error: '请输入邮箱和密码' }, { status: 400 });
  }

  const result = await loginAdmin(email, password);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, twoFA: result.twoFA ?? false },
      { status: result.status },
    );
  }

  await logAdminOperation({
    request,
    admin: result.user,
    action: 'ADMIN_LOGIN',
    targetType: 'auth',
    targetId: result.user.id,
    details: {
      email: result.user.email,
    },
  });

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(
    SESSION_COOKIE,
    result.token,
    sessionCookieOptions(Math.floor(result.expiresInMs / 1000)),
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', clearSessionCookieOptions());
  return response;
}
