import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectHonkaiArticleSchedules } from '../src/features/collection/honkai';
import { parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { collectHonkaiOfficialItems } from '../src/features/collection/honkai/official';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { scheduleIdentifiers } from '../shared/schedule-reference';
import { isCalendarEvent } from '../shared/calendar';
import { isEstimatedPeriod } from '../src/features/calendar/utils/calendar';
import { createCalendarCollector } from '../src/features/collection';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/honkai-8.9-update.json', import.meta.url), 'utf8')) as {
  articles: HonkaiArticle[]; timeline: unknown; timelineUrl: string;
};
const stages = ['2026-06-18T14:59:59Z', '2026-06-26T14:59:59Z', '2026-07-16T14:59:59Z', '2026-08-13T14:59:59Z'];
const replay = async (cutoff: string) => {
  const now = Date.parse(cutoff);
  const articles = fixture.articles.filter((article) => article.createdAt * 1000 <= now);
  const parsed = parseHonkaiSchedules(articles);
  const inventory = collectHonkaiOfficialItems(articles, parsed.events).filter((item) => item.version === '8.9');
  const timeline = parseHonkaiPublicTimeline(fixture.timeline,
    parsed.events.find((event) => event.id === 'honkai:version:8.9')!, articles, fixture.timelineUrl, true);
  const result = await collectHonkaiArticleSchedules(articles, { now, fetchTimeline: async (version, sources, useAliases) =>
    version.id === 'honkai:version:8.9'
      ? parseHonkaiPublicTimeline(fixture.timeline, version, sources, fixture.timelineUrl, useAliases)
      : { version, events: [], issues: [], skipped: 0 } });
  const ids = new Set(inventory.map((item) => item.id));
  const events = result.events.filter((event) => ids.has(event.id) || event.id.startsWith('honkai:timeline:8.9:'));
  return { result, inventory, timeline, events };
};
const snapshots = await Promise.all(stages.map(replay));

test('8.9 실제 공지를 게시일 순서로 재생하고 공지 추가 후 기존 일정 ID 보존', (t) => {
  for (const [index, snapshot] of snapshots.entries()) {
    t.diagnostic(`${stages[index]}: 공식 목록 ${snapshot.inventory.length}, 표시 ${snapshot.events.length}, `
      + `이벤트 ${snapshot.events.filter((event) => event.kind === 'event').length}, `
      + `원본 표시 ${snapshot.timeline.events.length}, 외부 진단 ${snapshot.timeline.issues.length}`);
    if (!index) continue;
    for (const previous of snapshots[index - 1]!.events) {
      assert.ok(snapshot.events.some((event) => event.id === previous.id), previous.title);
    }
  }
});

test('8.9 점검 시작과 다음 버전 점검 공지의 종료 경계 반영', () => {
  const version = snapshots.at(-1)!.result.events.find((event) => event.id === 'honkai:version:8.9')!;
  assert.equal(version.startAt, '2026-06-25T08:00:00.000Z');
  assert.equal(version.endAt, '2026-08-20T02:00:00.000Z');
});

test('8.9 공식 캐릭터 공지의 시작·종료 시각 유지', () => {
  const events = snapshots.at(-1)!.events.filter((event) => event.title.startsWith('치유의 깃 ·'));
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.startAt === '2026-06-25T08:00:00.000Z'
    && event.endAt === '2026-08-07T03:00:00.000Z' && event.crossChecked));
});

test('8.9 기간 미확정 공식 항목을 관리자 진단으로 보존', () => {
  const { events, inventory, result } = snapshots.at(-1)!;
  for (const item of inventory) {
    assert.ok(events.some((event) => event.id === item.id)
      || result.issues.some((issue) => issue.id === `${item.id}:period`), item.title);
  }
});

test('8.9 공식 예고에 기간이 명시된 보급 9개를 모두 표시', () => {
  const titles = snapshots.at(-1)!.events.map((event) => event.title);
  const expected = ['치유의 깃 · 캐릭터 보급', '치유의 깃 · 장비 보급',
    '진×언월여명 · 캐릭터 보급', '진×언월여명 · 장비 보급',
    '안녕♪ 사랑의 엘프♥ · 캐릭터 보급', '안녕♪ 사랑의 엘프♥ · 장비 보급',
    '백록·유운 · 협력 보급', '테레사·아포칼립스 · 협력 보급', '달의 소녀 · 코스튬 보급'];
  assert.deepEqual(expected.filter((title) => !titles.includes(title)), []);
});

test('8.9 백록·유운 협력 보급에 같은 줄의 다른 캐릭터 기간을 연결하지 않음', () => {
  const event = snapshots.at(-1)!.events.find((event) => event.title === '백록·유운 · 협력 보급')!;
  assert.equal(event.startAt, '2026-06-25T08:00:00.000Z');
  assert.equal(event.endAt, '2026-07-24T03:00:00.000Z');
});

test('8.9 이름 연결 없이도 원본 이벤트 8개와 전체 원본 23개 표시', () => {
  for (const snapshot of snapshots) {
    assert.equal(snapshot.timeline.events.length, 23);
    assert.equal(snapshot.timeline.events.filter((event) => event.kind === 'event').length, 8);
    for (const original of snapshot.timeline.events) {
      const displayed = snapshot.events.find((event) => scheduleIdentifiers(event).includes(original.id));
      assert.ok(displayed, original.title);
      assert.ok(isCalendarEvent(displayed));
      assert.equal(displayed.crossChecked, false);
      assert.ok(isEstimatedPeriod(displayed));
      assert.deepEqual(displayed.collectionSources, original.collectionSources);
    }
  }
});

test('8.9 외부 이름 대조 실패를 최종 수집 결과의 진단에 전달', () => {
  const { timeline, result } = snapshots.at(-1)!;
  assert.ok(timeline.issues.length > 0);
  for (const issue of timeline.issues) assert.ok(result.issues.some((candidate) => candidate.id === issue.id), issue.id);
});

test('8.9 원본 일정이 최종 수집·회차 병합·캐시 저장 후에도 모두 유지', async () => {
  const snapshot = snapshots.at(-1)!;
  const collector = createCalendarCollector({ now: () => Date.parse(stages.at(-1)!),
    read: async () => undefined, write: async (_game, stored) => {
      for (const original of snapshot.timeline.events) {
        assert.ok(stored.events.some((event) => scheduleIdentifiers(event).includes(original.id)), original.title);
      }
    }, fetcher: async () => structuredClone(snapshot.result) });
  const { calendar } = await collector.collectCalendar(true, { cause: 'manual', games: ['honkai'] });
  assert.ok(calendar.events.every(isCalendarEvent));
  for (const original of snapshot.timeline.events) {
    assert.ok(calendar.events.some((event) => scheduleIdentifiers(event).includes(original.id)), original.title);
  }
});
