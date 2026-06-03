/** LibreChat message content part types (aligned with data-provider ContentTypes) */
const TEXT = 'text';
const THINK = 'think';
const TEXT_DELTA = 'text_delta';
const TOOL_CALL = 'tool_call';
const ERROR = 'error';
const SUMMARY = 'summary';
const IMAGE_FILE = 'image_file';
const IMAGE_URL = 'image_url';
const AGENT_UPDATE = 'agent_update';

type ContentPart = Record<string, unknown>;

export type ParsedMessageBody = {
  text: string;
  thinking: string;
  extras: string[];
  isEmpty: boolean;
};

function readStringField(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === 'string' ? nested : '';
  }
  return '';
}

function parseContentPart(part: ContentPart): { text: string; thinking: string; extra: string } {
  const type = String(part.type ?? '');

  if (type === TEXT || type === TEXT_DELTA) {
    const fromText = readStringField(part.text);
    const fromDelta = readStringField(part.text_delta);
    const fromKeyed = readStringField(part[type]);
    return { text: fromText || fromDelta || fromKeyed, thinking: '', extra: '' };
  }

  if (type === THINK) {
    const think = readStringField(part.think) || readStringField(part[type]);
    return { text: '', thinking: think, extra: '' };
  }

  if (type === ERROR) {
    const err =
      readStringField(part.error) ||
      readStringField(part[ERROR]) ||
      readStringField(part.text);
    return { text: '', thinking: '', extra: err ? `[错误] ${err}` : '' };
  }

  if (type === TOOL_CALL) {
    const tc = (part.tool_call ?? part[TOOL_CALL]) as Record<string, unknown> | undefined;
    const name = tc?.name ? String(tc.name) : 'unknown';
    const output = tc?.output ? String(tc.output).slice(0, 500) : '';
    const args = tc?.args ? JSON.stringify(tc.args).slice(0, 200) : '';
    const body = output || args;
    return {
      text: body,
      thinking: '',
      extra: body ? `[工具调用: ${name}]` : `[工具调用: ${name}]`,
    };
  }

  if (type === SUMMARY) {
    const nested = part.content;
    if (Array.isArray(nested)) {
      const text = nested
        .map((item) => {
          const p = item as ContentPart;
          return p.type === TEXT ? readStringField(p.text) : '';
        })
        .filter(Boolean)
        .join('\n');
      return { text, thinking: '', extra: text ? '[摘要]' : '' };
    }
    return { text: '', thinking: '', extra: '[摘要]' };
  }

  if (type === IMAGE_FILE || type === IMAGE_URL) {
    return { text: '', thinking: '', extra: '[图片/附件]' };
  }

  if (type === AGENT_UPDATE) {
    return { text: '', thinking: '', extra: '[Agent 状态更新]' };
  }

  // Fallback: some providers store plain text without type
  if (typeof part.text === 'string' || (part.text && typeof part.text === 'object')) {
    return { text: readStringField(part.text), thinking: '', extra: '' };
  }

  return { text: '', thinking: '', extra: '' };
}

export function parseMessageBody(raw: {
  text?: string;
  content?: unknown;
  summary?: string;
}): ParsedMessageBody {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const extras: string[] = [];

  if (raw.text?.trim()) {
    textParts.push(raw.text.trim());
  }

  if (raw.summary?.trim()) {
    extras.push(`[摘要] ${raw.summary.trim()}`);
  }

  if (Array.isArray(raw.content)) {
    for (const item of raw.content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const parsed = parseContentPart(item as ContentPart);
      if (parsed.text) {
        textParts.push(parsed.text);
      }
      if (parsed.thinking) {
        thinkingParts.push(parsed.thinking);
      }
      if (parsed.extra) {
        extras.push(parsed.extra);
      }
    }
  }

  const text = textParts.join('\n\n').trim();
  const thinking = thinkingParts.join('\n\n').trim();

  // Thinking-only messages: show thinking as primary readable content
  const displayText = text || thinking;
  const displayThinking = text ? thinking : '';

  return {
    text: displayText,
    thinking: displayThinking,
    extras,
    isEmpty: !displayText && extras.length === 0,
  };
}

/** One-line preview for conversation list */
export function messagePreview(raw: { text?: string; content?: unknown; summary?: string }, max = 80) {
  const parsed = parseMessageBody(raw);
  const source = parsed.text || parsed.extras.join(' ') || '';
  if (!source) {
    return '';
  }
  return source.length > max ? `${source.slice(0, max)}…` : source;
}
