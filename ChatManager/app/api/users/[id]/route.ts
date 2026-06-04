import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { getAdminForOperationLog, logAdminOperation } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import { deleteUserById, getUserAuditLabel, updateUserById, userAuditLabel } from '@/lib/users';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Valid user id is required' }, { status: 400 });
  }

  const body = (await request.json()) as {
    name?: string;
    username?: string;
    role?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    tenantId?: string;
  };

  const user = await updateUserById(id, body);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const changedFields = ['name', 'username', 'role', 'emailVerified', 'tenantId'].filter(
    (field) => body[field as keyof typeof body] !== undefined,
  );
  const logTasks: Promise<void>[] = [];
  const accountLabel = userAuditLabel(user);

  if (typeof body.disabled === 'boolean') {
    logTasks.push(
      logAdminOperation({
        request,
        admin: getAdminForOperationLog(request),
        action: body.disabled ? 'USER_DISABLE' : 'USER_ENABLE',
        targetType: 'user',
        targetId: id,
        details: {
          mode: 'single',
          accountLabel,
          email: user.email,
          username: user.username,
        },
      }),
    );
  }

  if (changedFields.length > 0) {
    logTasks.push(
      logAdminOperation({
        request,
        admin: getAdminForOperationLog(request),
        action: 'USER_UPDATE',
        targetType: 'user',
        targetId: id,
        details: {
          changedFields,
          accountLabel,
          email: user.email,
          username: user.username,
        },
      }),
    );
  }

  await Promise.all(logTasks);

  return NextResponse.json({ user });
}

export async function DELETE(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Valid user id is required' }, { status: 400 });
  }

  const accountLabel = await getUserAuditLabel(id);
  await deleteUserById(id);
  await logAdminOperation({
    request,
    admin: getAdminForOperationLog(request),
    action: 'USER_DELETE',
    targetType: 'user',
    targetId: id,
    details: {
      mode: 'single',
      accountLabel,
    },
  });
  return NextResponse.json({ ok: true });
}
