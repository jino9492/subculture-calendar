import { isRecord } from './calendar';

export interface NoticeInput { title: string; content: string }
export interface Notice extends NoticeInput { id: string; publishedAt: string }
export const isNoticeInput = (value: unknown): value is NoticeInput => isRecord(value)
  && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200
  && typeof value.content === 'string' && value.content.trim().length > 0 && value.content.length <= 10000;
export const isNotice = (value: unknown): value is Notice => isNoticeInput(value) && isRecord(value)
  && typeof value.id === 'string' && value.id.length > 0
  && typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt));
export const isNoticeList = (value: unknown): value is Notice[] => Array.isArray(value) && value.every(isNotice);
