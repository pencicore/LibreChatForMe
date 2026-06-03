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

export function formatTime(value?: string | Date) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
