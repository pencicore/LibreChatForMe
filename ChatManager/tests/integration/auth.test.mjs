import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_TOKEN, BASE_URL, apiRequest, useIntegrationTestServer } from './helpers/test-server.mjs';

useIntegrationTestServer();

describe('认证 API 集成测试', () => {
  it('未携带管理 token 时，受保护接口应返回 401', async () => {
    // 真实调用受保护 API，验证中间鉴权逻辑，而不是直接测试 auth 函数。
    const response = await fetch(`${BASE_URL}/api/users`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: 'Unauthorized' });
  });

  it('携带静态管理 token 时，session 接口应返回管理员身份', async () => {
    const { response, body } = await apiRequest('/api/auth/session', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    assert.equal(response.status, 200);
    assert.equal(body.authenticated, true);
    assert.equal(body.authRequired, true);
    assert.equal(body.user.id, 'static-admin');
    assert.equal(body.user.role, 'ADMIN');
  });
});
