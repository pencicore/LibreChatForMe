import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { userFixture } from './helpers/fixtures.mjs';
import { apiRequest, getDb, useIntegrationTestServer } from './helpers/test-server.mjs';

useIntegrationTestServer();

describe('聊天记录 API 集成测试', () => {
  it('应通过 API 查询、查看详情、归档并删除会话，同时验证数据库副作用', async () => {
    const db = getDb();
    const user = userFixture({ email: 'chat-owner@example.test', username: 'chat-owner' });
    const conversationId = 'conv-integration-1';

    await db.collection('users').insertOne(user);
    await db.collection('conversations').insertOne({
      conversationId,
      title: 'Integration Conversation',
      user: user._id.toString(),
      model: 'gpt-test',
      endpoint: 'openAI',
      archived: false,
      tags: ['seed'],
      createdAt: new Date('2026-01-02T03:00:00.000Z'),
      updatedAt: new Date('2026-01-02T03:10:00.000Z'),
    });
    await db.collection('messages').insertMany([
      {
        messageId: 'msg-1',
        conversationId,
        user: user._id.toString(),
        sender: 'User',
        text: 'hello integration test',
        model: 'gpt-test',
        isCreatedByUser: true,
        createdAt: new Date('2026-01-02T03:01:00.000Z'),
        updatedAt: new Date('2026-01-02T03:01:00.000Z'),
      },
      {
        messageId: 'msg-2',
        conversationId,
        user: user._id.toString(),
        sender: 'Assistant',
        text: 'assistant response',
        model: 'gpt-test',
        isCreatedByUser: false,
        createdAt: new Date('2026-01-02T03:02:00.000Z'),
        updatedAt: new Date('2026-01-02T03:02:00.000Z'),
      },
    ]);

    // 通过消息内容搜索会话，覆盖 conversations 与 messages 的关联查询。
    const list = await apiRequest('/api/chat-records?q=hello&limit=10');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.conversations[0].conversationId, conversationId);
    assert.equal(list.body.conversations[0].email, 'chat-owner@example.test');
    assert.equal(list.body.conversations[0].messageCount, 2);
    assert.equal(list.body.stats.all, 1);
    assert.equal(list.body.stats.active, 1);

    const detail = await apiRequest(`/api/chat-records/${conversationId}?messageLimit=10`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.conversation.title, 'Integration Conversation');
    assert.equal(detail.body.conversation.messages.length, 2);
    assert.equal(detail.body.conversation.messages[0].displayText, 'hello integration test');

    const archive = await apiRequest(`/api/chat-records/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true, tags: ['reviewed'], chatManagerNotes: 'checked by test' }),
    });
    assert.equal(archive.response.status, 200);
    assert.deepEqual(archive.body, { ok: true });

    const archived = await db.collection('conversations').findOne({ conversationId });
    assert.equal(archived.archived, true);
    assert.deepEqual(archived.tags, ['reviewed']);
    assert.equal(archived.chatManagerNotes, 'checked by test');
    assert.ok(archived.expiredAt instanceof Date);
    assert.ok(await db.collection('admin_operation_logs').findOne({ action: 'CONVERSATION_ARCHIVE', targetId: conversationId }));

    const deleted = await apiRequest(`/api/chat-records/${conversationId}`, { method: 'DELETE' });
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body, { ok: true });
    assert.equal(await db.collection('conversations').countDocuments({ conversationId }), 0);
    assert.equal(await db.collection('messages').countDocuments({ conversationId }), 0);
    assert.ok(await db.collection('admin_operation_logs').findOne({ action: 'CONVERSATION_DELETE', targetId: conversationId }));
  });
});
