import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { parseWuwaStructuredCalendar } from '../src/features/collection/wuwa/public';
import { parseEndfieldBoundary, parseEndfieldEvents } from '../src/features/collection/endfield';
import { learnEndfieldChallengeNames } from '../src/features/collection/endfield/structured';
import { parseStructuredActivities } from '../src/features/collection/sra';
import { reconcileSchedules } from '../src/features/collection/reconciliation';
import { completedEventIds, toggleCompletion } from '../src/features/completion';
import { TimelineCalendar } from '../src/features/calendar/components/TimelineCalendar';
import { dayNumber } from '../src/features/calendar/utils/calendar';

const url = 'https://example.com/calendar';
const now = Date.parse('2026-10-11T03:00:00Z');
const parseWeekly = (time = [['2026-06-15T04:00:00+08:00']], sourceId = 103600001) => parseWuwaStructuredCalendar({
  servers: [{ label: 'Asia', utc: '+8' }], list: [{ id: 3, child: [{ id: sourceId * 100 + 2, sourceId, time, season: { cycle: { weeks: 1 } } }] }],
}, { versions: [] }, url, {}, 'und', now);

test('명조 두 주간 콘텐츠는 원본 반복 규칙으로 별도 분류하고 엔드콘텐츠는 유지', () => {
  for (const sourceId of [103600001, 105500002]) {
    const event = parseWeekly(undefined, sourceId).events[0];
    assert.ok(event && isCalendarEvent(event));
    assert.equal(event.kind, 'weekly');
    assert.equal(event.startAt, '2026-10-04T20:00:00.000Z');
    assert.equal(event.endAt, '2026-10-11T20:00:00.000Z');
    assert.equal(event.periodBasis, 'community-cycle');
    assert.equal(event.displayLanguage, 'ko-kr');
  }
  const unknown = parseWeekly(undefined, 999999).events[0];
  assert.equal(unknown?.kind, 'challenge');
  const explicit = parseWeekly([['2026-10-05T04:00:00+08:00', '2026-10-12T03:59:59.999+08:00']]).events[0];
  assert.equal(explicit?.kind, 'weekly');
  assert.equal(explicit?.endAt, '2026-10-11T20:00:00.000Z');
});

test('명조 주간 분류 변경 후 기존 완료를 승계하고 다음 주에는 초기화', () => {
  const event = parseWeekly().events[0]!;
  const old: CalendarEvent = { ...event, kind: 'challenge' };
  const records = toggleCompletion([], old, [old], now);
  assert.equal(reconcileSchedules([old]).events[0]?.kind, 'weekly');
  assert.ok(completedEventIds(records, [event]).has(event.id));
  const next = { ...event, id: `${event.id}:next`, startAt: event.endAt, endAt: '2026-10-18T20:00:00.000Z' };
  assert.equal(completedEventIds(records, [next]).size, 0);
  assert.equal(completedEventIds(records, [{ ...event, localizationKey: 'unrelated', id: 'unrelated' }]).size, 0);
});

test('타임라인에 명조 주간 콘텐츠 섹션과 완료 버튼 표시', () => {
  const event = parseWeekly().events[0]!;
  const first = dayNumber(event.startAt), last = dayNumber(event.endAt);
  const markup = renderToStaticMarkup(createElement(TimelineCalendar, {
    first, last, days: Array.from({ length: last - first + 1 }, (_, index) => first + index), now, selectedDay: first, focusRevision: 0,
    events: [event], endingEvents: [event], onSelectDay: () => {}, onSelectEvent: () => {}, isCompleted: () => false, onToggleCompletion: () => {},
  }));
  assert.ok(markup.includes('명조 주간 콘텐츠'));
  assert.ok(markup.includes('수많은 문의 환상 · 완료 표시'));
});

const article = { id: '5208', title: '「눈꽃 속에 피어난 고요한 꿈」 버전 업데이트 설명', content: [
  'Asia 서버: 2026/09/02 06:00 ~ 2026/09/02 12:00(UTC+8)',
  '1. 「전쟁의 메아리」 상시 도전 콘텐츠 업데이트',
  '· 개방 기간: 「눈꽃 속에 피어난 고요한 꿈」 버전 업데이트 후 상시 개방',
  '○「허상의 회상」',
  '· 시즌 업데이트: 「눈꽃 속에 피어난 고요한 꿈」 버전 업데이트 후 ~ 2026/09/24 11:59(서버 시간)',
  '· 업데이트 설명: 새로운 시즌 개방',
  '○「착시의 회상」',
  '· 시즌 업데이트: 2026/09/24 12:00(서버 시간) ~ 버전 업데이트 전까지',
  '· 업데이트 설명: 새로운 시즌 개방',
  '2. 「다른 콘텐츠」 업데이트',
  '○「다른 시즌」',
  '· 시즌 업데이트: 2026/09/24 12:00 ~ 2026/10/01 12:00',
].map((line) => `<p>${line}</p>`).join('') };

test('전쟁의 메아리 상시 개방과 시즌을 구분하고 공식 점검으로 종료 연결', () => {
  const boundary = parseEndfieldBoundary(article)!;
  const next = { version: '다음 버전', maintenanceStart: '2026-10-14T22:00:00.000Z', startAt: '2026-10-15T04:00:00.000Z', sourceUrl: url };
  const parsed = parseEndfieldEvents(article, [boundary, next]);
  assert.deepEqual(parsed.events.map((event) => [event.kind, event.title]), [
    ['challenge', '전쟁의 메아리 · 허상의 회상'], ['challenge', '전쟁의 메아리 · 착시의 회상'],
  ]);
  assert.equal(parsed.events[0]?.startAt, boundary.startAt);
  assert.equal(parsed.events[1]?.endAt, next.maintenanceStart);
  const unresolved = parseEndfieldEvents(article, [boundary]);
  assert.equal(unresolved.events.length, 1);
  assert.ok(unresolved.unresolvedPeriods.some((reason) => reason.includes('착시의 회상') && reason.includes('버전 종료 경계 미수집')));
});

test('엔필 구조화 원본의 같은 시즌을 공식 한국어 제목·엔드콘텐츠로 병합', () => {
  const boundary = { ...parseEndfieldBoundary(article)!, endAt: '2026-10-14T22:00:00.000Z', endSourceUrl: url };
  const official = parseEndfieldEvents(article, [boundary]).events;
  const raw = { activities: [{ name: '[Season of Illusion] (Echoes of War)', startTime: '2026-09-24T12:00:00', endTime: '2026-10-15T05:59:59' }] };
  const names = learnEndfieldChallengeNames(raw, official, {});
  const supplementary = parseStructuredActivities(raw, url, 'endfield', names);
  assert.equal(supplementary.events[0]?.kind, 'challenge');
  assert.equal(supplementary.events[0]?.title, '전쟁의 메아리 · 착시의 회상');
  assert.equal(reconcileSchedules([...official, ...supplementary.events]).events.length, 2);
  assert.deepEqual(learnEndfieldChallengeNames(raw, [], {}), {});
});
