import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { after, before, beforeEach } from 'node:test';
import { MongoClient } from 'mongodb';

export const PORT = Number(process.env.CHAT_MANAGER_TEST_PORT || 3107);
export const HOST = '127.0.0.1';
export const BASE_URL = `http://${HOST}:${PORT}`;
export const ADMIN_TOKEN = process.env.CHAT_MANAGER_TEST_ADMIN_TOKEN || 'chat-manager-integration-token';
export const MONGO_URI = process.env.CHAT_MANAGER_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ChatManagerTest';

const TEST_COLLECTIONS = [
  'users',
  'conversations',
  'messages',
  'sessions',
  'logs',
  'keyv',
  'transactions',
  'admin_operation_logs',
];

let server;
let serverOutput = '';
let mongo;
let db;
let setupPromise;
let cleanupRegistered = false;

function spawnServer() {
  if (!existsSync('.next/BUILD_ID')) {
    throw new Error('ChatManager 集成测试需要先构建生产包，请先运行 `npm run build`。');
  }

  const child = spawn('npm', ['run', 'start', '--', '-H', HOST, '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGO_URI,
      CHAT_MANAGER_ADMIN_TOKEN: ADMIN_TOKEN,
      JWT_SECRET: process.env.JWT_SECRET || 'integration-test-secret-integration-test-secret',
      LIBRECHAT_DATA_DIR: process.env.LIBRECHAT_DATA_DIR || '/tmp/chat-manager-integration-tests',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`ChatManager 测试服务提前退出。\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/api/auth/session`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`服务未就绪，状态码 ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`等待 ChatManager 测试服务超时：${BASE_URL}。最后错误：${lastError?.message}\n${serverOutput}`);
}

async function setup() {
  mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  db = mongo.db();

  server = spawnServer();
  await waitForServer();
}

async function teardown() {
  await clearDatabase().catch(() => undefined);
  await mongo?.close();

  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
}

export function useIntegrationTestServer() {
  before(async () => {
    setupPromise ??= setup();
    await setupPromise;
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // node:test 每个文件是独立进程，所以这里按文件注册清理即可。
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    after(teardown);
  }
}

export function getDb() {
  if (!db) {
    throw new Error('测试数据库尚未初始化，请先调用 useIntegrationTestServer()。');
  }

  return db;
}

export async function clearDatabase() {
  if (!db) {
    return;
  }

  await Promise.all(TEST_COLLECTIONS.map((name) => db.collection(name).deleteMany({})));
}

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}
