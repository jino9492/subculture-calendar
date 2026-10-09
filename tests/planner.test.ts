import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { completedEventIds, toggleCompletion } from '../src/features/completion';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { buildHomeworkPlan, latestAvailableAt, DEFAULT_OPTIONS, restorePlannerPreferences, PlannerPanel, type PlannerOptions } from '../src/features/planner';

const DAY = 86400000;
const now = Date.parse('2099-01-01T00:00:00Z');
const task = (id: string, start = 0, end = 5): CalendarEvent => ({ id, title: `새 과제 ${id}`, game: 'genshin', kind: 'event',
  startAt: new Date(now + start * DAY).toISOString(), endAt: new Date(now + end * DAY).toISOString(),
  sourceUrl: 'https://example.com', description: '', sourceLanguage: 'ko-kr', identityKey: `content:${id}` });
const zeroMargin = { ...DEFAULT_OPTIONS, marginHours: 0 };

test('예전 수행 조건 캐시는 폐기하고 추천 시간 설정만 복원', () => {
  const options = { ...DEFAULT_OPTIONS, marginHours: 12, availability: 'weekends' as const, hourKst: 19 };
  const saved = { options, entries: [{ requirement: { mode: 'daily', requiredVisits: 30 } }] };
  assert.deepEqual(restorePlannerPreferences(saved), { options });
  assert.deepEqual(restorePlannerPreferences({ options: { marginHours: -1, hourKst: 99 } }), { options: DEFAULT_OPTIONS });
});

test('미래 과제 시작 경계와 시작 후 마감 여유 부족 검사', () => {
  const event = task('future', 2, 5);
  const result = buildHomeworkPlan([event], () => false, DEFAULT_OPTIONS, now);
  assert.equal(result.visits[0]?.at, now + 4 * DAY);
  assert.ok(result.visits[0] && result.visits[0].at >= Date.parse(event.startAt));
  const narrow = task('narrow', 2, 2.5);
  assert.match(buildHomeworkPlan([narrow], () => false, DEFAULT_OPTIONS, now).attention[0]?.reason ?? '', /시작 후 마감 여유/);
});

test('출석·단계·누적 문구도 수행 조건을 추정하거나 별도 처리하지 않음', () => {
  const events = [task('a'), task('b'), task('c')];
  const titles = ['30일 출석 이벤트', '3단계 개방 이벤트', '누적 포인트 보상'];
  const renamed = events.map((event, i) => ({ ...event, title: titles[i] ?? event.title }));
  const original = buildHomeworkPlan(events, () => false, DEFAULT_OPTIONS, now);
  const result = buildHomeworkPlan(renamed, () => false, DEFAULT_OPTIONS, now);
  assert.deepEqual(result.visits.map((visit) => ({ at: visit.at, ids: visit.tasks.map((row) => row.event.id) })),
    original.visits.map((visit) => ({ at: visit.at, ids: visit.tasks.map((row) => row.event.id) })));
  assert.equal(result.attention.length, 0);
  assert.ok(result.remaining.every((row) => Object.keys(row).join(',') === 'event'));
});

test('겹치는 과제를 마감순으로 묶고 추천 시각과 실제 배타적 종료 경계 준수', () => {
  const events = [task('a', 0, 4), task('b', 2, 8), task('c', 6, 10)];
  const result = buildHomeworkPlan(events, () => false, zeroMargin, now);
  assert.equal(result.visits.length, 2);
  assert.deepEqual(result.visits.map((visit) => visit.tasks.map((row) => row.event.id)), [['a', 'b'], ['c']]);
  for (const visit of result.visits) for (const row of visit.tasks) {
    assert.ok(visit.at >= Math.max(now, Date.parse(row.event.startAt)));
    assert.ok(visit.at < Date.parse(row.event.endAt));
  }
  assert.deepEqual(buildHomeworkPlan([...events].reverse(), () => false, zeroMargin, now), result);
});

test('완료·만료·버전 제외, 픽업 명시 선택과 제목과 무관한 기간 계산', () => {
  const events = [task('done'), { ...task('expired', -5, -1) }, { ...task('version'), kind: 'version' as const },
    { ...task('banner'), kind: 'banner' as const }, { ...task('unknown'), title: '매일 출석 이벤트' }];
  const plan = buildHomeworkPlan(events, (event) => event.id === 'done', DEFAULT_OPTIONS, now);
  assert.deepEqual(plan.remaining.map((row) => row.event.id), ['unknown']);
  assert.equal(buildHomeworkPlan(events, (event) => event.id === 'done', { ...DEFAULT_OPTIONS, includeBanners: true }, now).remaining.length, 2);
});


test('마감 여유가 지난 과제는 즉시 처리 목록으로 분리하고 실제 종료 후에는 제외', () => {
  const event = task('urgent', 0, .5);
  const result = buildHomeworkPlan([event], () => false, DEFAULT_OPTIONS, now + 1);
  assert.equal(result.visits.length, 0);
  assert.equal(result.immediate.length, 1);
  assert.match(result.immediate[0]?.reason ?? '', /지금 처리/);
  assert.equal(buildHomeworkPlan([event], () => false, DEFAULT_OPTIONS, Date.parse(event.endAt)).remaining.length, 0);
});

test('한국 시간 저녁·주말 접속 시각과 접속 불가능 구간', () => {
  const daily = { ...zeroMargin, availability: 'daily' as const, hourKst: 20 };
  const event = task('evening', 0, 2);
  const at = buildHomeworkPlan([event], () => false, daily, now).visits[0]?.at;
  assert.ok(at !== undefined);
  assert.equal(new Date(at + 9 * 3600000).getUTCHours(), 20);
  const weekends = { ...daily, availability: 'weekends' as const };
  const weekendAt = buildHomeworkPlan([task('weekend', 0, 10)], () => false, weekends, now).visits[0]?.at;
  assert.ok(weekendAt !== undefined);
  assert.ok([0, 6].includes(new Date(weekendAt + 9 * 3600000).getUTCDay()));
  const minute = { ...event, endAt: new Date(now + 60000).toISOString() };
  assert.equal(buildHomeworkPlan([minute], () => false, daily, now).attention.length, 1);
});





test('전체 조합 탐색으로 단일 수행 추천의 최소 방문 횟수 검증', () => {
  let seed = 97;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (const availability of ['any', 'daily', 'weekends'] as const) for (let round = 0; round < 70; round++) {
    const options: PlannerOptions = { ...zeroMargin, availability, hourKst: 20 };
    const events = Array.from({ length: 1 + random() % 7 }, (_, i) => { const start = random() % 10; return task(`generated-${i}`, start, start + 1 + random() % 6); });
    const feasible = events.filter((event) => latestAvailableAt(Math.max(now, Date.parse(event.startAt)), Date.parse(event.endAt) - 1, options) !== undefined);
    const points = [...new Set(feasible.flatMap((event) => { const at = latestAvailableAt(Math.max(now, Date.parse(event.startAt)), Date.parse(event.endAt) - 1, options); return at === undefined ? [] : [at]; }))];
    let minimum = feasible.length;
    for (let mask = 0; mask < 2 ** points.length; mask++) {
      const chosen = points.filter((_, i) => mask & 2 ** i);
      if (chosen.length >= minimum) continue;
      if (feasible.every((event) => chosen.some((at) => at >= Math.max(now, Date.parse(event.startAt)) && at < Date.parse(event.endAt)))) minimum = chosen.length;
    }
    const result = buildHomeworkPlan(events, () => false, options, now);
    assert.equal(result.visits.length, minimum);
    const assigned = result.visits.flatMap((visit) => visit.tasks.map((row) => row.event.id));
    assert.equal(new Set(assigned).size, feasible.length);
    for (const visit of result.visits) for (const row of visit.tasks) assert.ok(visit.at >= Date.parse(row.event.startAt) && visit.at < Date.parse(row.event.endAt));
  }
});

test('실제 다섯 게임 전체 자료에서 모든 미완료 후보가 추천 또는 확인 목록에 포함', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('./fixtures/audited-schedules.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.every(isCalendarEvent));
  const result = buildHomeworkPlan(raw, () => false, DEFAULT_OPTIONS, Date.parse('2026-10-09T03:00:00+09:00'));
  const accounted = new Set([...result.visits.flatMap((visit) => visit.tasks.map((row) => row.event.id)), ...result.immediate.map((row) => row.task.event.id), ...result.attention.map((row) => row.task.event.id)]);
  assert.ok(result.remaining.length > 0);
  assert.equal(accounted.size, result.remaining.length);
});

test('검색은 추천 목록만 거르고 전체 방문 계산과 주의 안내 유지', () => {
  const events = [task('a', 0, 4), task('b', 2, 8), task('c', 6, 10)];
  const props = { events, now, query: '과제 a', isCompleted: () => false,
    gameLabel: () => '원신', gameIcon: () => '/icons/genshin_thumb.png', onSelectEvent: () => {}, onSelectTime: () => {}, onToggleCompletion: () => {} };
  const html = renderToStaticMarkup(createElement(PlannerPanel, props));
  assert.match(html, /미완료 3개 · 추천 방문 2회/);
  assert.match(html, /새 과제 a/);
  assert.doesNotMatch(html, /새 과제 b/);
  assert.match(html, /수행 조건은 확인하지 않으니 주의 바랍니다\./);
  assert.doesNotMatch(html, /과제 수행 조건 설정|조건 미확인|출석 횟수/);
  assert.match(html, /검색은 결과 목록만/);
});


test('완료·기간 변경·새 과제 추가 시 이전 추천을 재사용하지 않고 재계산', () => {
  const events = [task('a', 0, 4), task('b', 2, 8)];
  assert.equal(buildHomeworkPlan(events, () => false, zeroMargin, now).visits.length, 1);
  const changed = [events[0], { ...events[1], startAt: new Date(now + 6 * DAY).toISOString() }].filter(isCalendarEvent);
  assert.equal(buildHomeworkPlan(changed, () => false, zeroMargin, now).visits.length, 2);
  const completed = buildHomeworkPlan(changed, (event) => event.id === 'a', zeroMargin, now);
  assert.deepEqual(completed.remaining.map((row) => row.event.id), ['b']);
  assert.equal(completed.visits.length, 1);
  const additional = [...changed, task('new', 9, 12)];
  assert.equal(buildHomeworkPlan(additional, () => false, zeroMargin, now).visits.length, 3);
});

test('추천·긴급·충돌 과제는 완료 후에도 행과 배치를 유지하고 체크·반투명 표시 및 취소', () => {
  const events = [task('regular'), task('urgent', 0, .5), task('conflict', 2, 2.5)];
  const render = (isCompleted: (event: CalendarEvent) => boolean) => renderToStaticMarkup(createElement(PlannerPanel, {
    events, now, query: '', isCompleted, gameLabel: () => '원신', gameIcon: () => '/icons/genshin_thumb.png',
    onSelectEvent: () => {}, onSelectTime: () => {}, onToggleCompletion: () => {},
  }));
  const before = render(() => false);
  assert.equal((before.match(/aria-pressed="false"/g) ?? []).length, 3);
  for (const event of events) {
    assert.ok(before.includes(`${event.title} · 완료 표시`));
    assert.ok(before.includes(`${event.title} 상세 보기`));
    const checked = toggleCompletion([], event, events, now);
    const completed = completedEventIds(checked, events);
    assert.ok(completed.has(event.id));
    const after = render((candidate) => completed.has(candidate.id));
    assert.ok(after.includes(event.title));
    assert.ok(after.includes(`${event.title} · 완료 취소`));
    assert.equal((after.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((after.match(/class="[^"]*task-completed[^"]*"/g) ?? []).length, 1);
    assert.match(after, /✓/);
    assert.match(after, /미완료 2개/);
    assert.match(after, /추천 방문 1회/);
    const undone = completedEventIds(toggleCompletion(checked, event, events, now + 1), events);
    const restored = render((candidate) => undone.has(candidate.id));
    assert.ok(restored.includes(`${event.title} · 완료 표시`));
    assert.doesNotMatch(restored, /task-completed/);
  }
  const allDone = render(() => true);
  assert.equal((allDone.match(/aria-pressed="true"/g) ?? []).length, 3);
  assert.equal((allDone.match(/class="[^"]*task-completed[^"]*"/g) ?? []).length, 3);
  assert.match(allDone, /미완료 0개/);
  assert.match(allDone, /모두 완료/);
  assert.ok(events.every((event) => allDone.includes(event.title)));
});
