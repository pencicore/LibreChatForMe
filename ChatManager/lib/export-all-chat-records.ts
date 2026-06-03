import { createReadStream, createWriteStream } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObjectId } from 'mongodb';
import { ZipArchive } from 'archiver';
import ExcelJS from 'exceljs';
import { collections } from '@/lib/db';
import { jsonDate } from '@/lib/http';
import { parseMessageBody } from '@/lib/message-content';

const MESSAGE_BATCH = 200;
const UNKNOWN_USER_KEY = '__unknown__';

type RawConvo = {
  conversationId: string;
  title?: string;
  user?: string;
  model?: string;
  createdAt?: Date;
  updatedAt?: Date;
  archived?: boolean;
};

type UserProfile = {
  userId: string;
  label: string;
  fileName: string;
};

function sanitizeFileStem(value: string) {
  const stem = value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').trim();
  return stem.slice(0, 48) || 'user';
}

function buildUserFileName(userId: string, email?: string, username?: string) {
  const stem = sanitizeFileStem(username || email?.split('@')[0] || userId.slice(-12));
  const suffix = userId === UNKNOWN_USER_KEY ? 'unknown' : userId.slice(-8);
  return `${stem}_${suffix}.xlsx`;
}

async function resolveUserProfiles(userIds: string[]): Promise<Map<string, UserProfile>> {
  const profiles = new Map<string, UserProfile>();

  if (userIds.includes(UNKNOWN_USER_KEY)) {
    profiles.set(UNKNOWN_USER_KEY, {
      userId: UNKNOWN_USER_KEY,
      label: '未知用户',
      fileName: 'unknown_user.xlsx',
    });
  }

  const validIds = userIds.filter((id) => id !== UNKNOWN_USER_KEY && ObjectId.isValid(id));
  if (validIds.length === 0) {
    return profiles;
  }

  const { users } = await collections();
  const docs = await users
    .find(
      { _id: { $in: validIds.map((id) => new ObjectId(id)) } },
      { projection: { email: 1, username: 1, name: 1 } },
    )
    .toArray();

  for (const doc of docs) {
    const userId = doc._id.toString();
    const email = String(doc.email ?? '');
    const username = (doc.username as string | undefined) || (doc.name as string | undefined);
    const label = username ? `${username} (${email || userId})` : email || userId;
    profiles.set(userId, {
      userId,
      label,
      fileName: buildUserFileName(userId, email, username),
    });
  }

  for (const userId of validIds) {
    if (!profiles.has(userId)) {
      profiles.set(userId, {
        userId,
        label: userId,
        fileName: buildUserFileName(userId),
      });
    }
  }

  return profiles;
}

async function listUserIdsWithConversations(): Promise<string[]> {
  const { conversations } = await collections();
  const [knownUsers, hasUnknown] = await Promise.all([
    conversations.distinct('user', {
      user: { $exists: true, $nin: [null, ''] },
    }) as Promise<string[]>,
    conversations.countDocuments({
      $or: [{ user: { $exists: false } }, { user: null }, { user: '' }],
    }),
  ]);

  const ids = knownUsers.filter(Boolean);
  if (hasUnknown > 0) {
    ids.push(UNKNOWN_USER_KEY);
  }

  return ids;
}

function userFilter(userId: string) {
  if (userId === UNKNOWN_USER_KEY) {
    return { $or: [{ user: { $exists: false } }, { user: null }, { user: '' }] };
  }
  return { user: userId };
}

async function listConversationsForUser(userId: string): Promise<RawConvo[]> {
  const { conversations } = await collections();
  const docs = await conversations
    .find(userFilter(userId), {
      projection: {
        conversationId: 1,
        title: 1,
        user: 1,
        model: 1,
        createdAt: 1,
        updatedAt: 1,
        archived: 1,
      },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return docs as unknown as RawConvo[];
}

async function* iterateMessageBatches(conversationId: string) {
  const { messages } = await collections();
  const cursor = messages
    .find({ conversationId })
    .sort({ createdAt: 1 })
    .project({
      sender: 1,
      text: 1,
      content: 1,
      summary: 1,
      isCreatedByUser: 1,
      createdAt: 1,
    })
    .batchSize(MESSAGE_BATCH);

  let batch: Array<Record<string, unknown>> = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= MESSAGE_BATCH) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

function formatMessageContent(raw: Record<string, unknown>) {
  const parsed = parseMessageBody({
    text: raw.text as string | undefined,
    content: raw.content as unknown[] | undefined,
    summary: raw.summary as string | undefined,
  });

  const parts = [parsed.text.trim()];
  if (parsed.thinking.trim()) {
    parts.push(`[思考] ${parsed.thinking.trim()}`);
  }
  if (parsed.extras.length > 0) {
    parts.push(parsed.extras.join('\n'));
  }

  return parts.filter(Boolean).join('\n\n') || '';
}

async function writeUserWorkbook(
  filePath: string,
  profile: UserProfile,
  convos: RawConvo[],
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useSharedStrings: true,
  });

  const sheet = workbook.addWorksheet('聊天记录');
  sheet.columns = [
    { header: '用户', key: 'userLabel', width: 24 },
    { header: '会话ID', key: 'conversationId', width: 30 },
    { header: '会话标题', key: 'title', width: 28 },
    { header: '会话创建时间', key: 'convoCreatedAt', width: 20 },
    { header: '会话更新时间', key: 'convoUpdatedAt', width: 20 },
    { header: '模型', key: 'model', width: 22 },
    { header: '消息时间', key: 'messageAt', width: 20 },
    { header: '角色', key: 'role', width: 10 },
    { header: '发送者', key: 'sender', width: 18 },
    { header: '消息内容', key: 'content', width: 80 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  let messageCount = 0;

  for (const convo of convos) {
    for await (const batch of iterateMessageBatches(convo.conversationId)) {
      for (const raw of batch) {
        const isUser = raw.isCreatedByUser === true;
        sheet
          .addRow({
            userLabel: profile.label,
            conversationId: convo.conversationId,
            title: convo.title || 'New Chat',
            convoCreatedAt: jsonDate(convo.createdAt),
            convoUpdatedAt: jsonDate(convo.updatedAt),
            model: convo.model ?? '',
            messageAt: jsonDate(raw.createdAt as Date),
            role: isUser ? '用户' : 'AI',
            sender: String(raw.sender ?? (isUser ? '用户' : 'AI')),
            content: formatMessageContent(raw),
          })
          .commit();
        messageCount += 1;
      }
    }
  }

  await workbook.commit();
  return messageCount;
}

async function zipExcelFiles(sourceDir: string, zipPath: string) {
  const entries = await readdir(sourceDir);
  const excelFiles = entries.filter((name) => name.endsWith('.xlsx'));

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve());
    archive.on('error', reject);
    output.on('error', reject);

    archive.pipe(output);

    for (const name of excelFiles) {
      archive.file(path.join(sourceDir, name), { name });
    }

    void archive.finalize();
  });
}

export type ExportAllChatRecordsResult = {
  zipPath: string;
  tempDir: string;
  userCount: number;
  conversationCount: number;
  messageCount: number;
};

export async function exportAllChatRecordsToZip(): Promise<ExportAllChatRecordsResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'cm-chat-export-'));
  const zipPath = path.join(tempDir, 'chat-records-all.zip');

  const userIds = await listUserIdsWithConversations();
  const profiles = await resolveUserProfiles(userIds);

  let conversationCount = 0;
  let messageCount = 0;
  const usedNames = new Set<string>();

  for (const userId of userIds) {
    const profile =
      profiles.get(userId) ??
      ({
        userId,
        label: userId,
        fileName: buildUserFileName(userId),
      } satisfies UserProfile);

    let fileName = profile.fileName;
    if (usedNames.has(fileName)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      fileName = `${base}_${userId.slice(-6)}${ext}`;
    }
    usedNames.add(fileName);

    const convos = await listConversationsForUser(userId);
    if (convos.length === 0) {
      continue;
    }

    const filePath = path.join(tempDir, fileName);
    const count = await writeUserWorkbook(filePath, profile, convos);
    conversationCount += convos.length;
    messageCount += count;
  }

  const excelCount = (await readdir(tempDir)).filter((name) => name.endsWith('.xlsx')).length;
  if (excelCount === 0) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error('没有可导出的聊天记录');
  }

  await zipExcelFiles(tempDir, zipPath);

  return {
    zipPath,
    tempDir,
    userCount: excelCount,
    conversationCount,
    messageCount,
  };
}

export function openZipReadStream(zipPath: string) {
  return createReadStream(zipPath);
}

export async function cleanupExportTempDir(tempDir: string) {
  await rm(tempDir, { recursive: true, force: true });
}
