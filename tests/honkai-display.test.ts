import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CalendarEvent } from '../shared/calendar';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { calendarRange, dayNumber, groupEndingEvents, isEstimatedPeriod, visibleCalendarEvents } from '../src/features/calendar/utils/calendar';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/honkai-9.1-events.json', import.meta.url), 'utf8'));
const version: CalendarEvent = { id: 'honkai:version:9.1', title: '9.1 버전', game: 'honkai', kind: 'version',
  startAt: '2026-10-22T08:00:00.000Z', endAt: '2026-12-23T15:00:00.000Z', sourceLanguage: 'ko-kr',
  sourceUrl: fixture.article.url, description: '' };

test('실제 9.1 미번역 원본만 캘린더에서 제외하고 한국어 예상 일정은 유지', () => {
  const { events } = parseHonkaiPublicTimeline(fixture.timeline, version, [fixture.article],
    'https://www.arustats.com/en-us/hi3/timeline/9.1', true);
  const before = structuredClone(events);
  const visible = visibleCalendarEvents(events);
  assert.ok(visible.length > 0 && visible.length < events.length);
  assert.ok(!visible.some((event) => event.title === 'Heroic Expedition Starts on Monday'));
  assert.ok(visible.some((event) => event.title === '만남♪ 추억의 장난감 집' && isEstimatedPeriod(event)));
  assert.ok(events.filter((event) => !visible.includes(event)).every((event) => !event.displayLanguage && event.sourceLanguage === 'en-us'));
  assert.deepEqual(events, before);
});

test('한국어 이름·검증 상태와 무관하게 공식 종료가 있으면 예상 배지 제외', () => {
  const endAt = version.endAt;
  const event = { ...version, kind: 'event' as const, periodBasis: 'community-data' as const, crossChecked: true,
    timeEvidence: { end: { at: endAt, sourceUrl: version.sourceUrl, basis: 'community-data' as const, precision: 'date' as const } } };
  assert.equal(isEstimatedPeriod(event), true);
  for (const basis of ['official', 'manual'] as const) {
    assert.equal(isEstimatedPeriod({ ...event, crossChecked: false, timeEvidence: {
      end: { ...event.timeEvidence.end, basis } } }), false);
  }
  assert.equal(isEstimatedPeriod({ ...version, versionEndBasis: 'default-42-days' }), true);
});

test('미번역 제외는 날짜 범위·종료 집계에도 적용하고 다른 게임은 유지', () => {
  const hidden = { ...version, id: 'untranslated', kind: 'event' as const, title: 'Untranslated Event',
    sourceLanguage: 'en-us', startAt: '2026-12-25T00:00:00Z', endAt: '2027-12-25T00:00:00Z' };
  const other = { ...hidden, id: 'other-game', game: 'genshin' as const, startAt: version.startAt, endAt: version.endAt };
  const visible = visibleCalendarEvents([version, hidden, other]);
  assert.deepEqual(visible.map((event) => event.id), [version.id, other.id]);
  assert.equal(calendarRange(visible, Date.parse(version.startAt))!.last, dayNumber(version.endAt));
  assert.ok(![...groupEndingEvents(visible, dayNumber(version.startAt), dayNumber(hidden.endAt)).values()]
    .flat().some((event) => event.id === hidden.id));
});
