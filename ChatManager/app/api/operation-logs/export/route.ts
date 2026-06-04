import { NextResponse } from 'next/server';
import { listAdminOperationLogs, operationLogsToCsv } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import { parsePositiveInt } from '@/lib/http';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 10000, 50000);
  const result = await listAdminOperationLogs({
    page: 1,
    limit,
    q: searchParams.get('q'),
    module: searchParams.get('module'),
    action: searchParams.get('action'),
    status: searchParams.get('status'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
  });

  return new NextResponse(`\uFEFF${operationLogsToCsv(result.logs)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="operation-logs-${Date.now()}.csv"`,
    },
  });
}
