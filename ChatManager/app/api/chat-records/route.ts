import { NextResponse } from 'next/server';
import { getAdminForOperationLog, logAdminOperation } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import {
  buildConversationSearch,
  conversationsToCsv,
  deleteConversation,
  getConversationAuditLabel,
  getConversationStats,
  listConversations,
} from '@/lib/conversations';
import { parsePositiveInt } from '@/lib/http';
import type { ConversationTab } from '@/types/librechat';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 20, 100);
  const page = parsePositiveInt(searchParams.get('page'), 1, 100000);
  const tab = (searchParams.get('tab')?.toUpperCase() || 'ALL') as ConversationTab;

  const filter = await buildConversationSearch({
    q: searchParams.get('q'),
    userId: searchParams.get('userId'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    tab: ['ALL', 'ACTIVE', 'ARCHIVED'].includes(tab) ? tab : 'ALL',
  });

  const [list, stats] = await Promise.all([
    listConversations({
      filter,
      page,
      limit,
      sort: searchParams.get('sort') === 'oldest' ? 'oldest' : 'latest',
    }),
    getConversationStats(),
  ]);

  return NextResponse.json({
    conversations: list.conversations,
    total: list.total,
    page,
    limit,
    stats,
  });
}

export async function DELETE(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { conversationId?: string };
  if (!body.conversationId?.trim()) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
  }

  const conversationTitle = await getConversationAuditLabel(body.conversationId.trim());
  await deleteConversation(body.conversationId.trim());
  await logAdminOperation({
    request,
    admin: getAdminForOperationLog(request),
    action: 'CONVERSATION_DELETE',
    targetType: 'conversation',
    targetId: body.conversationId.trim(),
    details: {
      conversationTitle,
    },
  });
  return NextResponse.json({ ok: true });
}
