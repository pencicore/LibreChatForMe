import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { getDashboardStats } from '@/lib/dashboard';
import { parsePositiveInt } from '@/lib/http';
import type { DashboardGranularity } from '@/types/librechat';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const rawGranularity = searchParams.get('granularity');
  const granularity: DashboardGranularity =
    rawGranularity === 'minute' ||
    rawGranularity === 'hour' ||
    rawGranularity === 'week' ||
    rawGranularity === 'day'
      ? rawGranularity
      : 'day';

  const stats = await getDashboardStats({
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    userId: searchParams.get('userId'),
    trendUserId: searchParams.get('trendUserId'),
    granularity,
    topUsers: parsePositiveInt(searchParams.get('topUsers'), 5, 20),
    topRatioUsers: parsePositiveInt(searchParams.get('topRatioUsers'), 10, 30),
  });

  return NextResponse.json({ stats });
}
