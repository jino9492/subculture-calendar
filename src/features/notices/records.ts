import type { Notice } from '../../../shared/notices';

export const NOTICE_READ_KEY = 'subdays:read-notices:v1';
export const parseReadNotices = (value: string | null): string[] => {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : [];
  } catch { return []; }
};
export const unreadNotices = (notices: Notice[], readIds: string[]): Notice[] => {
  const read = new Set(readIds);
  return notices.filter((notice) => !read.has(notice.id));
};
export const markNoticesRead = (value: string | null, notices: Notice[]): string[] =>
  [...new Set([...parseReadNotices(value), ...notices.map((notice) => notice.id)])];
