import { Readable } from 'stream';
import { requireAdminToken } from '@/lib/auth';
import {
  cleanupExportTempDir,
  exportAllChatRecordsToZip,
  openZipReadStream,
} from '@/lib/export-all-chat-records';

export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  let tempDir = '';

  try {
    const result = await exportAllChatRecordsToZip();
    tempDir = result.tempDir;

    const nodeStream = openZipReadStream(result.zipPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    nodeStream.on('close', () => {
      void cleanupExportTempDir(tempDir);
    });
    nodeStream.on('error', () => {
      void cleanupExportTempDir(tempDir);
    });

    const filename = `chat-records-all-${Date.now()}.zip`;

    return new Response(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Users': String(result.userCount),
        'X-Export-Conversations': String(result.conversationCount),
        'X-Export-Messages': String(result.messageCount),
      },
    });
  } catch (error) {
    if (tempDir) {
      await cleanupExportTempDir(tempDir).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : '导出失败';
    const status = message.includes('没有可导出') ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
