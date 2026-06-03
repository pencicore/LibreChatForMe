import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { buildConversationSearch, conversationsToCsv, listConversations } from '@/lib/conversations';
import { parsePositiveInt } from '@/lib/http';
import type { ConversationTab } from '@/types/librechat';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 5000, 10000);
  const tab = (searchParams.get('tab')?.toUpperCase() || 'ALL') as ConversationTab;

  const filter = await buildConversationSearch({
    q: searchParams.get('q'),
    userId: searchParams.get('userId'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    tab: ['ALL', 'ACTIVE', 'ARCHIVED'].includes(tab) ? tab : 'ALL',
  });

  const list = await listConversations({ filter, page: 1, limit });
  const csv = conversationsToCsv(list.conversations);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chat-records-${Date.now()}.csv"`,
    },
  });
}
