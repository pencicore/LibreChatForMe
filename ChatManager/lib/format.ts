export function formatUserId(id: string) {
  return `usr_${id.slice(-16).toUpperCase()}`;
}

export function formatDateTime(value?: string | Date) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function formatCount(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return new Intl.NumberFormat('en-US').format(value);
}

export function displayInitials(source: string, fallback = 'CH') {
  const trimmed = source.trim();
  if (!trimmed) {
    return fallback;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  const chars = [...trimmed.replace(/\s/g, '')];
  if (chars.length === 0) {
    return fallback;
  }

  if (/[\u4e00-\u9fff]/.test(chars[0])) {
    return chars.slice(0, Math.min(2, chars.length)).join('');
  }

  return chars.slice(0, 2).join('').toUpperCase();
}

export function avatarColorIndex(seed: string, paletteSize = 6) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % paletteSize;
}

export function formatTime(value?: string | Date) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
