import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';

const ACCESS_ADMIN = 'access:admin';

type PrincipalQuery = {
  principalType: string;
  principalId: string | ObjectId;
};

async function getUserGroupIds(userId: string): Promise<ObjectId[]> {
  const database = await getDb();
  const groups = database.collection('groups');
  const objectId = new ObjectId(userId);

  const docs = await groups
    .find({ memberIds: objectId })
    .project({ _id: 1 })
    .toArray();

  return docs.map((doc) => doc._id as ObjectId);
}

function buildPrincipalQueries(userId: string, role?: string): PrincipalQuery[] {
  const queries: PrincipalQuery[] = [
    { principalType: 'user', principalId: new ObjectId(userId) },
  ];

  if (role?.trim()) {
    queries.push({ principalType: 'role', principalId: role.trim() });
  }

  return queries;
}

export async function hasAdminAccess(
  userId: string,
  role?: string,
  tenantId?: string,
): Promise<boolean> {
  const database = await getDb();
  const grants = database.collection('systemgrants');

  const principals = buildPrincipalQueries(userId, role);
  const groupIds = await getUserGroupIds(userId);

  for (const groupId of groupIds) {
    principals.push({ principalType: 'group', principalId: groupId });
  }

  if (principals.length === 0) {
    return false;
  }

  const tenantFilter = tenantId?.trim()
    ? { $or: [{ tenantId: tenantId.trim() }, { tenantId: { $exists: false } }] }
    : { tenantId: { $exists: false } };

  const doc = await grants.findOne({
    $and: [{ $or: principals }, { capability: ACCESS_ADMIN }, tenantFilter],
  });

  return doc != null;
}
