import { ObjectId } from 'mongodb';

export function userFixture(overrides = {}) {
  const now = new Date('2026-01-02T03:04:05.000Z');
  const id = overrides._id || new ObjectId();

  return {
    _id: id,
    email: 'alice@example.test',
    username: 'alice',
    name: 'Alice',
    emailVerified: true,
    disabled: false,
    password: 'hashed-password-must-not-leak',
    provider: 'local',
    role: 'USER',
    refreshToken: ['refresh-token'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
