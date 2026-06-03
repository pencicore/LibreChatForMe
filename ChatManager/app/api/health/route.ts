import { NextResponse } from 'next/server';
import { clearAllIpBanCaches, repairAllLegacyBanRecords } from '@/lib/ban';
import { clearLoginRateLimitArtifacts } from '@/lib/login-limits';
import { collections } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { users } = await collections();
  const [userCount, legacyBansFixed, ipBanCachesCleared, loginLimits] = await Promise.all([
    users.estimatedDocumentCount(),
    repairAllLegacyBanRecords(),
    clearAllIpBanCaches(),
    clearLoginRateLimitArtifacts(),
  ]);

  return NextResponse.json({
    ok: true,
    database: 'connected',
    users: userCount,
    legacyBansFixed,
    ipBanCachesCleared,
    loginLimits,
    note: '若仍提示登录次数过多，请重启 LibreChat 后端（限流计数在进程内存中）',
  });
}
