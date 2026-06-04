import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { getAdminForOperationLog, logAdminOperation } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import { deleteUsersByIds, getUserAuditLabels, updateUserById } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    ids?: string[];
    action?: 'disable' | 'enable' | 'delete' | 'verify';
  };

  const ids = (body.ids ?? []).filter((id) => ObjectId.isValid(id));

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid user ids provided' }, { status: 400 });
  }

  const accountLabels = await getUserAuditLabels(ids);

  if (body.action === 'delete') {
    await deleteUsersByIds(ids);
    await logAdminOperation({
      request,
      admin: getAdminForOperationLog(request),
      action: 'USER_DELETE',
      targetType: 'user',
      targetIds: ids,
      details: {
        mode: 'batch',
        affected: ids.length,
        accountLabels,
      },
    });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  for (const id of ids) {
    if (body.action === 'disable') {
      await updateUserById(id, { disabled: true });
    } else if (body.action === 'enable') {
      await updateUserById(id, { disabled: false, emailVerified: true });
    } else if (body.action === 'verify') {
      await updateUserById(id, { emailVerified: true });
    }
  }

  if (body.action === 'disable' || body.action === 'enable') {
    await logAdminOperation({
      request,
      admin: getAdminForOperationLog(request),
      action: body.action === 'disable' ? 'USER_DISABLE' : 'USER_ENABLE',
      targetType: 'user',
      targetIds: ids,
      details: {
        mode: 'batch',
        affected: ids.length,
        accountLabels,
      },
    });
  }

  return NextResponse.json({ ok: true, affected: ids.length });
}
