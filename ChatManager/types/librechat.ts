export type LibreChatUser = {
  _id: string;
  name?: string;
  username?: string;
  email: string;
  emailVerified?: boolean;
  disabled?: boolean;
  provider?: string;
  role?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  messageCount?: number;
};

export type UserStats = {
  total: number;
  active: number;
  newToday: number;
  disabled: number;
  admins: number;
  activeRate: number;
  adminRate: number;
};

export type UsersListResponse = {
  users: LibreChatUser[];
  total: number;
  page: number;
  limit: number;
  stats: UserStats;
};

export type BulkCreateInput = {
  prefix: string;
  domain: string;
  count: number;
  startIndex: number;
  password: string;
  randomPassword?: boolean;
  namePrefix: string;
  role: string;
  emailVerified: boolean;
  tenantId?: string;
};

export type BulkCreatePreviewItem = {
  email: string;
  username: string;
  name: string;
  status: 'new' | 'duplicate';
};

export type BulkCreatePreview = {
  items: BulkCreatePreviewItem[];
  summary: { total: number; newCount: number; duplicateCount: number };
};

export type BulkCreateResult = {
  created: Array<{
    email: string;
    username: string;
    name: string;
    password: string;
  }>;
  duplicates: Array<{ email: string; username: string }>;
};

export type ConversationTab = 'ALL' | 'ACTIVE' | 'ARCHIVED';

export type ConversationStats = {
  all: number;
  active: number;
  archived: number;
};

export type ConversationListItem = {
  conversationId: string;
  title: string;
  userId: string;
  username?: string;
  email?: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  messageCount: number;
  model?: string;
  endpoint?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  tags?: string[];
  chatManagerNotes?: string;
};

export type LibreChatMessage = {
  _id: string;
  messageId: string;
  conversationId: string;
  user: string;
  sender?: string;
  text?: string;
  content?: unknown[];
  summary?: string;
  model?: string;
  isCreatedByUser?: boolean;
  createdAt?: string;
  updatedAt?: string;
  displayText?: string;
  thinkingText?: string;
  extras?: string[];
};

export type ConversationDetail = ConversationListItem & {
  messages: LibreChatMessage[];
  messagePage: number;
  messagePages: number;
  messageTotal: number;
};

export type DashboardGranularity = 'minute' | 'hour' | 'day' | 'week';

export type DashboardUserSlice = {
  userId: string;
  label: string;
  tokens: number;
  percentage: number;
};

export type DashboardStats = {
  summary: {
    totalTokens: number;
    activeUsers: number;
    totalSessions: number;
    modelCount: number;
  };
  tokenTrend: Array<{ date: string; tokens: number }>;
  userDistribution: {
    total: number;
    top: DashboardUserSlice[];
    others: { tokens: number; percentage: number } | null;
  };
  modelUsage: Array<{ model: string; tokens: number }>;
  tokensPerSession: Array<{
    userId: string;
    label: string;
    tokens: number;
    sessions: number;
    ratio: number;
  }>;
};
