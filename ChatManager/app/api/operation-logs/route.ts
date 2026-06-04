import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { parsePositiveInt } from '@/lib/http';
import { listAdminOperationLogs } from '@/lib/admin-operation-logs';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const page = parsePositiveInt(searchParams.get('page'), 1, 100000);
  const limit = parsePositiveInt(searchParams.get('limit'), 10, 200);
  const result = await listAdminOperationLogs({
    page,
    limit,
    q: searchParams.get('q'),
    module: searchParams.get('module'),
    action: searchParams.get('action'),
    status: searchParams.get('status'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
  });

  return NextResponse.json({
    logs: result.logs,
    total: result.total,
    page,
    limit,
  });
}
