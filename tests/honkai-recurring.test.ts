import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isCalendarEvent } from '../shared/calendar';
import { buildHonkaiRecurringSchedules } from '../src/features/collection/honkai/custom/recurring';
import { refreshCustomSchedules } from '../src/features/collection/custom-schedules';

const local = (at: string) => new Date(Date.parse(at) + 9 * 3600000);
const currentWeek = (now: string) => buildHonkaiRecurringSchedules(Date.parse(now)).filter((event) =>
  event.startAt >= '2026-10-11T15:00:00.000Z' && event.startAt < '2026-10-18T15:00:00.000Z');

test('붕괴3rd 요청한 엔드 콘텐츠 2종·주간 콘텐츠 1종과 한국 서버 경계', () => {
  const events = currentWeek('2026-10-13T03:00:00Z');
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((event) => [event.title, event.kind, event.startAt, event.endAt]), [
    ['심연(초끈공간)', 'challenge', '2026-10-12T06:00:00.000Z', '2026-10-14T13:00:00.000Z'],
    ['심연(초끈공간)', 'challenge', '2026-10-16T06:00:00.000Z', '2026-10-18T13:00:00.000Z'],
    ['기억전장', 'challenge', '2026-10-12T19:00:00.000Z', '2026-10-18T19:00:00.000Z'],
    ['과거의 낙원', 'weekly', '2026-10-11T19:00:00.000Z', '2026-10-18T19:00:00.000Z'],
  ]);
  assert.ok(events.every(isCalendarEvent));
  assert.ok(events.every((event) => event.imageUrls?.length === 1 && existsSync(new URL(`../public${event.imageUrls[0]}`, import.meta.url))));
});

test('월요일 결산 공백·화요일 재개·심연 마감 공백을 구분', () => {
  for (const [at, name, expected] of [
    ['2026-10-11T18:59:59Z', '기억전장', 1], ['2026-10-11T19:00:00Z', '기억전장', 0],
    ['2026-10-12T18:59:59Z', '기억전장', 0], ['2026-10-12T19:00:00Z', '기억전장', 1],
    ['2026-10-11T19:00:00Z', '과거의 낙원', 1], ['2026-10-12T05:59:59Z', '심연(초끈공간)', 0],
    ['2026-10-12T06:00:00Z', '심연(초끈공간)', 1], ['2026-10-14T13:00:00Z', '심연(초끈공간)', 0],
  ] as const) {
    const now = Date.parse(at);
    assert.equal(buildHonkaiRecurringSchedules(now).filter((event) => event.title === name
      && Date.parse(event.startAt) <= now && now < Date.parse(event.endAt)).length, expected, `${name} ${at}`);
  }
});

test('연말·윤년·시간대와 무관한 주기·회차별 완료 ID 유지', () => {
  for (const at of ['2025-12-31T15:00:00Z', '2026-01-01T00:00:00+09:00', '2028-02-29T12:00:00Z', '2040-10-13T00:00:00Z']) {
    const events = buildHonkaiRecurringSchedules(Date.parse(at));
    assert.equal(events.length, 68); assert.equal(new Set(events.map((event) => event.id)).size, 68);
    assert.ok(events.every(isCalendarEvent));
    for (const event of events) {
      const start = local(event.startAt), end = local(event.endAt);
      if (event.title === '과거의 낙원') {
        assert.equal(start.getUTCDay(), 1); assert.equal(end.getUTCDay(), 1);
        assert.equal(start.getUTCHours(), 4); assert.equal(end.getUTCHours(), 4);
      } else if (event.title === '기억전장') {
        assert.equal(start.getUTCDay(), 2); assert.equal(end.getUTCDay(), 1);
        assert.equal(start.getUTCHours(), 4); assert.equal(end.getUTCHours(), 4);
      } else {
        assert.ok([1, 5].includes(start.getUTCDay())); assert.ok([3, 0].includes(end.getUTCDay()));
        assert.equal(start.getUTCHours(), 15); assert.equal(end.getUTCHours(), 22);
      }
    }
  }
  const before = buildHonkaiRecurringSchedules(Date.parse('2026-10-18T14:59:59Z'));
  const after = buildHonkaiRecurringSchedules(Date.parse('2026-10-18T15:00:00Z'));
  assert.equal(before.filter((event) => after.some((next) => next.id === event.id)).length, 64);
});

test('원본 수집 실패에도 주기 생성·재생성 중복 방지·일반 시각 규칙과 독립', () => {
  const now = Date.parse('2026-10-13T03:00:00Z');
  const first = refreshCustomSchedules('honkai', [], now);
  assert.equal(first.length, 68);
  assert.deepEqual(refreshCustomSchedules('honkai', first, now), first);
  const shifted = refreshCustomSchedules('honkai', first, now + 7 * 86400000);
  assert.equal(shifted.length, 68);
  assert.equal(new Set(shifted.map((event) => event.id)).size, shifted.length);
  assert.throws(() => buildHonkaiRecurringSchedules(NaN));
});
