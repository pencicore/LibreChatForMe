import { NextResponse } from 'next/server';
import {
  getAdminForOperationLog,
  logAdminOperation,
  redactBulkCreateDetails,
} from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import { createCompetitionUsers, parseBulkCreateInput, type BulkCreateBody } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as BulkCreateBody;
    const input = parseBulkCreateInput(body);
    const result = await createCompetitionUsers(input);
    await logAdminOperation({
      request,
      admin: getAdminForOperationLog(request),
      action: 'USER_BULK_CREATE',
      targetType: 'user',
      details: {
        source: 'bulk',
        prefix: input.prefix,
        domain: input.domain,
        count: input.count,
        startIndex: input.startIndex,
        role: input.role,
        emailVerified: input.emailVerified,
        tenantId: input.tenantId,
        randomPassword: input.randomPassword === true,
        ...redactBulkCreateDetails(result),
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
