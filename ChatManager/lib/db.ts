import mongoose from 'mongoose';

type CachedConnection = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var chatManagerMongoose: CachedConnection | undefined;
}

const cached = global.chatManagerMongoose ?? { conn: null, promise: null };

if (!global.chatManagerMongoose) {
  global.chatManagerMongoose = cached;
}

export async function connectDb() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI is required');
  }

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 10,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function getDb() {
  const connection = await connectDb();
  const db = connection.connection.db;

  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }

  return db;
}

export async function collections() {
  const db = await getDb();

  return {
    users: db.collection('users'),
    conversations: db.collection('conversations'),
    messages: db.collection('messages'),
    sessions: db.collection('sessions'),
    /** LibreChat keyvMongo 默认集合（BAN 等违规日志），非 keyv */
    logs: db.collection('logs'),
    /** 旧版 ChatManager 误写的封禁记录，迁移后删除 */
    legacyKeyv: db.collection('keyv'),
  };
}
