import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { userFixture } from './helpers/fixtures.mjs';
import { apiRequest, getDb, useIntegrationTestServer } from './helpers/test-server.mjs';

useIntegrationTestServer();

describe('用户列表与单用户更新 API 集成测试', () => {
  it('应通过 API 查询用户，并在禁用用户后持久化用户、会话、封禁和审计日志副作用', async () => {
    const db = getDb();
    const alice = userFixture();
    const bob = userFixture({
      _id: new ObjectId(),
      email: 'bob@example.test',
      username: 'bob',
      name: 'Bob',
      role: 'ADMIN',
    });

    // 准备接近 LibreChat 真实结构的数据，让 API 的聚合查询能走完整路径。
    await db.collection('users').insertMany([alice, bob]);
    await db.collection('messages').insertOne({
      conversationId: 'conv-user-count',
      user: alice._id.toString(),
      text: 'hello from alice',
      createdAt: new Date('2026-01-02T03:05:00.000Z'),
    });
    await db.collection('sessions').insertOne({
      user: alice._id,
      expiration: new Date('2026-01-03T00:00:00.000Z'),
    });

    const list = await apiRequest('/api/users?q=alice&limit=10');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.users[0].email, 'alice@example.test');
    assert.equal(list.body.users[0].messageCount, 1);
    assert.equal('password' in list.body.users[0], false);
    assert.equal(list.body.stats.total, 2);
    assert.equal(list.body.stats.admins, 1);

    const update = await apiRequest(`/api/users/${alice._id.toString()}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled: true, role: 'ADMIN' }),
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.body.user.disabled, true);
    assert.equal(update.body.user.role, 'ADMIN');

    // 禁用账户不仅更新 users，还应清 session、写 LibreChat ban 记录、写操作日志。
    const persisted = await db.collection('users').findOne({ _id: alice._id });
    assert.equal(persisted.disabled, true);
    assert.deepEqual(persisted.refreshToken, []);
    assert.equal(await db.collection('sessions').countDocuments({ user: alice._id }), 0);
    assert.ok(await db.collection('logs').findOne({ key: `BANS:${alice._id.toString()}` }));

    const actions = await db
      .collection('admin_operation_logs')
      .find({ targetId: alice._id.toString() })
      .project({ action: 1, details: 1 })
      .toArray();
    assert.deepEqual(actions.map((doc) => doc.action).sort(), ['USER_DISABLE', 'USER_UPDATE']);
    assert.deepEqual(actions.find((doc) => doc.action === 'USER_UPDATE').details.changedFields, ['role']);
  });
});
