import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { escapeRegex, jsonDate, startOfToday } from '@/lib/http';
import { messagePreview, parseMessageBody } from '@/lib/message-content';
import type { ConversationListItem, ConversationStats, ConversationTab, LibreChatMessage } from '@/types/librechat';

type RawConvo = {
  _id: ObjectId;
  conversationId: string;
  title?: string;
  user?: string;
  model?: string;
  endpoint?: string;
  tags?: string[];
  chatManagerNotes?: string;
  archived?: boolean;
  isTemporary?: boolean;
  expiredAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  lastMessage?: Array<{ text?: string; content?: unknown; createdAt?: Date; sender?: string }>;
  messageCount?: Array<{ count: number }>;
};

function tabFilter(tab: ConversationTab): Record<string, unknown> {
  if (tab === 'ARCHIVED') {
    return {
      $or: [{ archived: true }, { expiredAt: { $exists: true, $ne: null } }],
    };
  }

  if (tab === 'ACTIVE') {
    return {
      archived: { $ne: true },
      $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }],
      isTemporary: { $ne: true },
    };
  }

  return {};
}

export async function getConversationStats(): Promise<ConversationStats> {
  const { conversations } = await collections();

  const [all, active, archived] = await Promise.all([
    conversations.countDocuments({}),
    conversations.countDocuments(tabFilter('ACTIVE')),
    conversations.countDocuments(tabFilter('ARCHIVED')),
  ]);

  return { all, active, archived };
}

async function resolveUserIds(query: string) {
  const { users } = await collections();
  const pattern = new RegExp(escapeRegex(query), 'i');
  const matches = await users
    .find(
      { $or: [{ email: pattern }, { username: pattern }, { name: pattern }] },
      { projection: { _id: 1 } },
    )
    .limit(50)
    .toArray();

  return matches.map((user) => user._id.toString());
}

export async function buildConversationSearch(options: {
  q?: string | null;
  userId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tab?: ConversationTab;
}) {
  const filter: Record<string, unknown> = {
    ...tabFilter(options.tab ?? 'ALL'),
  };

  if (options.userId?.trim()) {
    filter.user = options.userId.trim();
  }

  if (options.startDate || options.endDate) {
    const range: Record<string, Date> = {};
    if (options.startDate) {
      range.$gte = new Date(`${options.startDate}T00:00:00`);
    }
    if (options.endDate) {
      range.$lte = new Date(`${options.endDate}T23:59:59`);
    }
    filter.updatedAt = range;
  }

  const q = options.q?.trim();
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    const userIds = await resolveUserIds(q);
    const messageMatches = await collections().then(({ messages }) =>
      messages
        .find({ text: pattern }, { projection: { conversationId: 1 } })
        .limit(80)
        .toArray(),
    );
    const conversationIdsFromMessages = [
      ...new Set(messageMatches.map((message) => message.conversationId as string)),
    ];

    filter.$or = [
      { title: pattern },
      { conversationId: pattern },
      ...(userIds.length ? [{ user: { $in: userIds } }] : []),
      ...(conversationIdsFromMessages.length
        ? [{ conversationId: { $in: conversationIdsFromMessages } }]
        : []),
    ];
  }

  return filter;
}

async function attachUsers(items: RawConvo[]): Promise<ConversationListItem[]> {
  if (items.length === 0) {
    return [];
  }

  const { users } = await collections();
  const userIds = [...new Set(items.map((item) => item.user).filter(Boolean))] as string[];
  const objectIds = userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

  const userDocs =
    objectIds.length > 0
      ? await users
          .find({ _id: { $in: objectIds } }, { projection: { email: 1, username: 1, name: 1 } })
          .toArray()
      : [];

  const userMap = new Map(
    userDocs.map((user) => [
      user._id.toString(),
      {
        username: user.username as string | undefined,
        email: user.email as string,
        name: user.name as string | undefined,
      },
    ]),
  );

  return items.map((item) => {
    const last = item.lastMessage?.[0];
    const count = item.messageCount?.[0]?.count ?? 0;
    const userInfo = item.user ? userMap.get(item.user) : undefined;

    return {
      conversationId: item.conversationId,
      title: item.title || 'New Chat',
      userId: item.user ?? '',
      username: userInfo?.username || userInfo?.name,
      email: userInfo?.email,
      lastMessagePreview:
        messagePreview({
          text: last?.text,
          content: last?.content,
        }) || '',
      lastMessageAt: jsonDate(last?.createdAt ?? item.updatedAt),
      messageCount: count,
      model: item.model,
      endpoint: item.endpoint,
      createdAt: jsonDate(item.createdAt),
      updatedAt: jsonDate(item.updatedAt),
      archived: item.archived === true || Boolean(item.expiredAt),
      tags: item.tags ?? [],
      chatManagerNotes: item.chatManagerNotes,
    };
  });
}

export async function listConversations(options: {
  filter: Record<string, unknown>;
  page: number;
  limit: number;
  sort?: 'latest' | 'oldest';
}) {
  const { conversations } = await collections();
  const skip = (options.page - 1) * options.limit;
  const sortDir = options.sort === 'oldest' ? 1 : -1;

  const pipeline = [
    { $match: options.filter },
    { $sort: { updatedAt: sortDir } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: options.limit },
          {
            $lookup: {
              from: 'messages',
              let: { convoId: '$conversationId' },
              pipeline: [
                { $match: { $expr: { $eq: ['$conversationId', '$$convoId'] } } },
                { $sort: { createdAt: -1 } },
                { $limit: 1 },
                { $project: { text: 1, content: 1, createdAt: 1, sender: 1 } },
              ],
              as: 'lastMessage',
            },
          },
          {
            $lookup: {
              from: 'messages',
              let: { convoId: '$conversationId' },
              pipeline: [
                { $match: { $expr: { $eq: ['$conversationId', '$$convoId'] } } },
                { $count: 'count' },
              ],
              as: 'messageCount',
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await conversations.aggregate(pipeline).toArray();
  const items = (result?.items ?? []) as RawConvo[];
  const total = result?.total?.[0]?.count ?? 0;

  return {
    conversations: await attachUsers(items),
    total,
  };
}

export async function getConversationDetail(
  conversationId: string,
  messagePage = 1,
  messageLimit = 20,
) {
  const { conversations, messages } = await collections();
  const convo = await conversations.findOne({ conversationId });

  if (!convo) {
    return null;
  }

  const messageTotal = await messages.countDocuments({ conversationId });
  const messagePages = Math.max(1, Math.ceil(messageTotal / messageLimit));
  const safePage = Math.min(Math.max(messagePage, 1), messagePages);
  const skip = (safePage - 1) * messageLimit;

  const [messageDocs, lastMessage] = await Promise.all([
    messages
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(messageLimit)
      .project({
        messageId: 1,
        conversationId: 1,
        user: 1,
        sender: 1,
        text: 1,
        content: 1,
        summary: 1,
        model: 1,
        isCreatedByUser: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .toArray(),
    messages.findOne({ conversationId }, { sort: { createdAt: -1 }, projection: { model: 1 } }),
  ]);

  const [mapped] = await attachUsers([
    {
      ...(convo as RawConvo),
      lastMessage: lastMessage
        ? [
            {
              text: lastMessage.text as string,
              content: lastMessage.content,
              createdAt: lastMessage.createdAt as Date,
            },
          ]
        : [],
      messageCount: [{ count: messageTotal }],
    },
  ]);

  const mappedMessages: LibreChatMessage[] = messageDocs.map((message) => {
    const parsed = parseMessageBody({
      text: message.text as string | undefined,
      content: message.content as unknown[] | undefined,
      summary: message.summary as string | undefined,
    });

    return {
      _id: message._id.toString(),
      messageId: String(message.messageId),
      conversationId: String(message.conversationId),
      user: String(message.user),
      sender: message.sender as string | undefined,
      text: message.text as string | undefined,
      content: message.content as unknown[] | undefined,
      summary: message.summary as string | undefined,
      model: message.model as string | undefined,
      isCreatedByUser: message.isCreatedByUser as boolean | undefined,
      createdAt: jsonDate(message.createdAt as Date),
      updatedAt: jsonDate(message.updatedAt as Date),
      displayText: parsed.text,
      thinkingText: parsed.thinking,
      extras: parsed.extras,
    };
  });

  return {
    ...mapped,
    model: mapped.model || (lastMessage?.model as string | undefined),
    messages: mappedMessages,
    messagePage: safePage,
    messagePages,
    messageTotal,
  };
}

export async function updateConversationMeta(
  conversationId: string,
  update: { tags?: string[]; chatManagerNotes?: string; archived?: boolean },
) {
  const { conversations } = await collections();
  const payload: Record<string, unknown> = { updatedAt: new Date() };

  if (update.tags) {
    payload.tags = update.tags;
  }
  if (typeof update.chatManagerNotes === 'string') {
    payload.chatManagerNotes = update.chatManagerNotes;
  }
  if (typeof update.archived === 'boolean') {
    payload.archived = update.archived;
    payload.expiredAt = update.archived ? new Date() : null;
  }

  const result = await conversations.findOneAndUpdate(
    { conversationId },
    { $set: payload },
    { returnDocument: 'after' },
  );

  return result;
}

export async function deleteConversation(conversationId: string) {
  const { conversations, messages } = await collections();
  await Promise.all([
    messages.deleteMany({ conversationId }),
    conversations.deleteOne({ conversationId }),
  ]);
}

export function conversationsToCsv(items: ConversationListItem[]) {
  const header = [
    'conversationId',
    'title',
    'userId',
    'email',
    'messageCount',
    'model',
    'createdAt',
    'updatedAt',
  ];
  const rows = items.map((item) => [
    item.conversationId,
    item.title,
    item.userId,
    item.email ?? '',
    String(item.messageCount),
    item.model ?? '',
    item.createdAt ?? '',
    item.updatedAt ?? '',
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
