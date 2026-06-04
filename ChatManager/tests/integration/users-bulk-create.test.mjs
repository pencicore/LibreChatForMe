import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiRequest, getDb, useIntegrationTestServer } from './helpers/test-server.mjs';

useIntegrationTestServer();

describe('批量创建用户 API 集成测试', () => {
  it('应通过 API 批量创建用户，密码落库为 hash，并记录审计日志', async () => {
    const db = getDb();

    const result = await apiRequest('/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        prefix: 'team',
        domain: 'example.test',
        count: 2,
        startIndex: 7,
        password: 'Password123!',
        namePrefix: 'Team ',
        role: 'USER',
        emailVerified: true,
      }),
    });

    assert.equal(result.response.status, 201);
    assert.deepEqual(
      result.body.created.map((user) => user.email),
      ['team7@example.test', 'team8@example.test'],
    );
    assert.deepEqual(result.body.duplicates, []);

    // 直接查数据库，确认 API 的业务副作用真实落库，而不是只验证响应体。
    const users = await db.collection('users').find({}).sort({ username: 1 }).toArray();
    assert.equal(users.length, 2);
    assert.deepEqual(
      users.map((user) => user.username),
      ['team7', 'team8'],
    );
    assert.ok(users.every((user) => typeof user.password === 'string' && user.password.startsWith('$2')));
    assert.ok(users.every((user) => user.password !== 'Password123!'));

    const log = await db.collection('admin_operation_logs').findOne({ action: 'USER_BULK_CREATE' });
    assert.equal(log.details.createdCount, 2);
    assert.equal(log.details.duplicateCount, 0);
    assert.equal(log.details.prefix, 'team');
  });
});
