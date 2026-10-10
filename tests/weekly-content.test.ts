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
import { buildStarrailWeeklySchedules } from '../src/features/collection/starrail/custom/weekly';
import { buildZenlessWeeklySchedules } from '../src/features/collection/zenless/custom/weekly';
import { createCalendarCollector } from '../src/features/collection/service';
import { mergeWuwaWeeklySchedules } from '../src/features/collection/wuwa/custom/weekly';

const url = 'https://example.com/calendar';
const now = Date.parse('2026-10-11T03:00:00Z');

test('스타레일·젠존제 주간 일정은 월요일 한국 시간 05시에 주차 전환하고 매주 연속', () => {
  const reset = Date.parse('2026-10-12T05:00:00+09:00');
  for (const build of [buildStarrailWeeklySchedules, buildZenlessWeeklySchedules]) {
    const before = build(reset - 1), after = build(reset);
    assert.equal(before.length, 5);
    assert.ok(after.every(isCalendarEvent));
    assert.equal(before[0]?.startAt, '2026-10-04T20:00:00.000Z');
    assert.equal(after[0]?.startAt, '2026-10-11T20:00:00.000Z');
    assert.equal(after[0]?.endAt, '2026-10-18T20:00:00.000Z');
    assert.equal(before[1]?.id, after[0]?.id);
    assert.notEqual(before[0]?.id, after[0]?.id);
    for (const [index, event] of after.entries()) {
      assert.equal(Date.parse(event.endAt) - Date.parse(event.startAt), 7 * 86400000);
      assert.equal(event.kind, 'weekly');
      assert.equal(event.timeEvidence?.end?.basis, 'schedule-rule');
      assert.deepEqual(event.imageUrls, [`/images/custom/${event.game}-weekly.png`]);
      if (index) assert.equal(after[index - 1]?.endAt, event.startAt);
    }
    const records = toggleCompletion([], before[0]!, before, reset - 1);
    assert.equal(completedEventIds(records, after).size, 0);
  }
});

test('원본 수집 캐시를 재사용해도 주간 일정은 조회 시점에 이동하고 미래 주차 자동 추가', async () => {
  let at = Date.parse('2026-10-12T04:59:59+09:00');
  let fetched = 0;
  const collector = createCalendarCollector({ now: () => at, read: async () => undefined, write: async () => {},
    fetcher: async () => {
      fetched++;
      return { events: [], issues: [], skipped: 0, partial: false, message: '원본 수집' };
    } });
  const context = { cause: 'request-expired' as const, games: ['starrail', 'zenless'] as const };
  const before = await collector.collectCalendar(false, { ...context, games: [...context.games] });
  at += 1000;
  const after = await collector.collectCalendar(false, { ...context, games: [...context.games] });
  assert.equal(fetched, 2);
  assert.equal(after.calendar.events.length, 10);
  for (const game of context.games) {
    const previous = before.calendar.events.filter((event) => event.game === game);
    const current = after.calendar.events.filter((event) => event.game === game);
    assert.equal(previous[1]?.id, current[0]?.id);
    assert.equal(current[4]?.startAt, previous[4]?.endAt);
  }
  at = Date.parse('2027-01-04T05:00:00+09:00');
  const future = await collector.collectCalendar(false, { ...context, games: [...context.games] });
  assert.equal(future.calendar.events[0]?.startAt, '2027-01-03T20:00:00.000Z');
});

test('API 실패 시에도 custom 주간 일정 생성', async () => {
  const collector = createCalendarCollector({ now: () => now, read: async () => undefined, write: async () => {},
    fetcher: async () => { throw new Error('API unavailable'); } });
  const result = await collector.collectCalendar(false, { cause: 'request-expired', games: ['starrail', 'zenless'] });
  assert.equal(result.calendar.events.length, 10);
  assert.ok(result.calendar.events.every((event) => event.kind === 'weekly'));
  assert.ok(result.calendar.sources.every((source) => source.state === 'error'));
});

test('스타레일·젠존제 주간 섹션과 완료 체크 표시', () => {
  const events = [...buildStarrailWeeklySchedules(now), ...buildZenlessWeeklySchedules(now)];
  const first = dayNumber(events[0]!.startAt), last = dayNumber(events[4]!.endAt);
  const markup = renderToStaticMarkup(createElement(TimelineCalendar, {
    first, last, days: Array.from({ length: last - first + 1 }, (_, index) => first + index), now, selectedDay: first, focusRevision: 0,
    events, endingEvents: events, onSelectDay: () => {}, onSelectEvent: () => {}, isCompleted: () => false, onToggleCompletion: () => {},
  }));
  assert.ok(markup.includes('스타레일 주간 콘텐츠'));
  assert.ok(markup.includes('젠레스 존 제로 주간 콘텐츠'));
  assert.ok(markup.includes('차분화 우주 / 화폐전쟁 · 완료 표시'));
  assert.ok(markup.includes('현상금 의뢰 · 완료 표시'));
  assert.ok(markup.includes('src="/images/custom/starrail-weekly.png"'));
  assert.ok(markup.includes('src="/images/custom/zenless-weekly.png"'));
});
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

test('명조 선택형 주간 임무는 API 기간을 유지하고 양쪽 완료 기록을 승계', () => {
  const originals = [parseWeekly().events[0]!, parseWeekly(undefined, 105500002).events[0]!];
  const merged = mergeWuwaWeeklySchedules(originals);
  assert.equal(merged.length, 1);
  const combined = merged[0]!;
  assert.ok(isCalendarEvent(combined));
  assert.equal(combined.title, '수많은 문의 환상 / 환상의 놀이공원');
  assert.deepEqual(combined.imageUrls, ['/images/custom/wuwa-weekly.png']);
  assert.equal(combined.startAt, originals[0]?.startAt);
  assert.equal(combined.endAt, originals[0]?.endAt);
  assert.deepEqual(mergeWuwaWeeklySchedules(merged), merged);
  assert.deepEqual(mergeWuwaWeeklySchedules([...originals].reverse()), merged);
  for (const original of originals) {
    const old = { ...original, kind: 'challenge' as const };
    const records = toggleCompletion([], old, [old], now);
    assert.ok(completedEventIds(records, merged).has(combined.id));
    const changedId = { ...original, id: 'replaced-source-id' };
    assert.ok(completedEventIds(toggleCompletion([], changedId, [changedId], now), merged).has(combined.id));
    const nextWeek = { ...original, id: `${original.id}:next`, startAt: original.endAt, endAt: '2026-10-18T20:00:00.000Z' };
    assert.equal(completedEventIds(records, mergeWuwaWeeklySchedules([nextWeek])).size, 0);
  }
});

test('명조 다른 주차는 합치지 않고 다른 엔드콘텐츠와 이벤트 유지', () => {
  const first = parseWeekly().events[0]!;
  const next = { ...parseWeekly(undefined, 105500002).events[0]!, startAt: first.endAt, endAt: '2026-10-18T20:00:00.000Z' };
  const challenge = { ...first, id: 'tower', localizationKey: 'wuwa:wiki:tower', kind: 'challenge' as const, title: '역경의 탑' };
  const event = { ...first, id: 'one-off', kind: 'event' as const };
  const merged = mergeWuwaWeeklySchedules([first, next, challenge, event]);
  assert.equal(merged.length, 4);
  assert.equal(merged.filter((item) => item.kind === 'weekly').length, 2);
  assert.ok(merged.includes(challenge));
  assert.ok(merged.includes(event));
});

test('명조 캐시도 조회 응답에서 통합하고 합성 이미지·완료 체크 표시', async () => {
  const originals = [parseWeekly().events[0]!, parseWeekly(undefined, 105500002).events[0]!];
  const collector = createCalendarCollector({ now: () => now,
    read: async () => ({ events: originals, issues: [], fetchedAt: new Date(now).toISOString(), skipped: 0, partial: false, message: '' }),
    fetcher: async () => { throw new Error('캐시 재사용 시 수집 불필요'); } });
  const result = await collector.collectCalendar(false, { cause: 'request-expired', games: ['wuwa'] });
  assert.equal(result.calendar.events.length, 1);
  assert.equal(result.calendar.sources[0]?.state, 'ok');
  const event = result.calendar.events[0]!;
  const first = dayNumber(event.startAt), last = dayNumber(event.endAt);
  const markup = renderToStaticMarkup(createElement(TimelineCalendar, {
    first, last, days: Array.from({ length: last - first + 1 }, (_, index) => first + index), now, selectedDay: first, focusRevision: 0,
    events: [event], endingEvents: [event], onSelectDay: () => {}, onSelectEvent: () => {}, isCompleted: () => false, onToggleCompletion: () => {},
  }));
  assert.ok(markup.includes('수많은 문의 환상 / 환상의 놀이공원 · 완료 표시'));
  assert.ok(markup.includes('src="/images/custom/wuwa-weekly.png"'));
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
