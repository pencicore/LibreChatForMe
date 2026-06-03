import fs from 'fs/promises';
import path from 'path';
import { collections } from '@/lib/db';

function getLibreChatDataDir() {
  if (process.env.LIBRECHAT_DATA_DIR) {
    return process.env.LIBRECHAT_DATA_DIR;
  }

  return path.resolve(process.cwd(), '../LibreChat/api/data');
}

/**
 * 清除 LibreChat 文件缓存中的违规/限流记录。
 * 登录次数限制（429）主要存在 API 进程内存中，清文件后仍需重启 LibreChat 后端。
 */
export async function clearLibreChatFileCaches(): Promise<string[]> {
  const dataDir = getLibreChatDataDir();
  const cleared: string[] = [];

  for (const file of ['violations.json', 'logs.json']) {
    const filePath = path.join(dataDir, file);
    try {
      await fs.unlink(filePath);
      cleared.push(file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return cleared;
}

/** 清除 MongoDB logs 中与登录违规相关的键（若存在） */
export async function clearLoginViolationKeys(): Promise<number> {
  const { logs } = await collections();
  const result = await logs.deleteMany({
    key: { $regex: /^(logins:|violations:logins)/i },
  });
  return result.deletedCount;
}

export async function clearLoginRateLimitArtifacts(): Promise<{
  filesCleared: string[];
  mongoKeysCleared: number;
}> {
  const [filesCleared, mongoKeysCleared] = await Promise.all([
    clearLibreChatFileCaches(),
    clearLoginViolationKeys(),
  ]);

  return { filesCleared, mongoKeysCleared };
}
