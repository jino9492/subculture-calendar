import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { endingNotifications } from '../src/features/calendar/utils/notifications';
import { DAY_MS, dayNumber } from '../src/features/calendar/utils/calendar';

const now = Date.parse('2026-11-06T14:00:00Z');
const event = (id: string, endAt: string): CalendarEvent => ({ id, endAt,
  startAt: '2026-11-01T00:00:00Z', title: id, game: 'genshin', kind: 'event',
  sourceUrl: 'https://example.com', description: '', sourceLanguage: 'ko-kr' });

test('알림은 종료 전부터 72시간 경계까지 포함하고 완료 일정과 시작 시점 버전은 제외', () => {
  const boundary = new Date(now + 3 * DAY_MS).toISOString();
  const events = [event('expired', new Date(now).toISOString()), event('boundary', boundary),
    event('outside', new Date(now + 3 * DAY_MS + 1).toISOString()),
    event('completed', new Date(now + 60000).toISOString()),
    { ...event('milestone', boundary), kind: 'version' as const, startAt: boundary }];
  assert.deepEqual(endingNotifications(events, now, (item) => item.id === 'completed')
    .flatMap(([, items]) => items.map((item) => item.id)), ['boundary']);
  assert.deepEqual(endingNotifications([], now, () => false), []);
});

test('알림은 한국 종료 날짜순으로 묶고 같은 날짜에는 종료 시각순으로 정렬', () => {
  const early = event('early', '2026-11-06T14:30:00Z');
  const midnight = event('midnight', '2026-11-06T15:00:00Z');
  const late = event('late', '2026-11-06T16:00:00Z');
  const groups = endingNotifications([late, midnight, early], now, () => false);
  assert.deepEqual(groups.map(([day, items]) => [day, items.map((item) => item.id)]), [
    [dayNumber(early.endAt), ['early']], [dayNumber(midnight.endAt), ['midnight', 'late']],
  ]);
  assert.deepEqual(endingNotifications([early], Date.parse(early.endAt), () => false), []);
});
