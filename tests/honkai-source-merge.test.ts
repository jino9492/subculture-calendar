import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CalendarEvent } from '../shared/calendar';
import { collectHonkaiOfficialItems, resolveHonkaiOfficialItems, mergeHonkaiScheduleSources } from '../src/features/collection/honkai/official';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { scheduleIdentifiers } from '../shared/schedule-reference';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/honkai-9.1-events.json', import.meta.url), 'utf8'));
const version: CalendarEvent = { id: 'honkai:version:9.1', title: '9.1 버전', game: 'honkai', kind: 'version',
  startAt: '2026-10-22T08:00:00.000Z', endAt: '2026-12-23T15:00:00.000Z', sourceLanguage: 'ko-kr',
  sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865', description: '',
  timeEvidence: { start: { at: '2026-10-22T08:00:00.000Z', basis: 'official', precision: 'minute',
    sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865' } } };

test('공식 공지의 종료 누락이나 추출 이름 차이는 독립 검증 일정의 삭제 조건이 아님', () => {
  const source = 'https://www.arustats.com/en-us/hi3/timeline/9.1';
  const external = parseHonkaiPublicTimeline(fixture.timeline, version, [fixture.article], source, true).events;
  const inventory = collectHonkaiOfficialItems([fixture.article], [version]);
  const official = resolveHonkaiOfficialItems(inventory, external);
  for (const [result, items] of [[official, inventory], [{ events: [], issues: [] }, []]] as const) {
    const merged = mergeHonkaiScheduleSources({ events: [...result.events], issues: [...result.issues] }, external, [...items]);
    for (const candidate of external) {
      assert.ok(merged.events.some((event) => scheduleIdentifiers(event).includes(candidate.id)), candidate.title);
    }
    assert.ok(merged.events.some((event) => event.title === '꿈에서 온 선물'));
    assert.ok(merged.events.some((event) => event.title === '만남♪ 추억의 장난감 집'));
    assert.ok(merged.events.some((event) => event.title === '달콤한 모래사장'));
  }
  const merged = mergeHonkaiScheduleSources(official, external, inventory);
  assert.ok(merged.issues.some((issue) => issue.title === '늦가을의 빛'));
  assert.ok(!merged.issues.some((issue) => issue.title === '꿈에서 온 선물'));
});

test('공식 정확 기간을 우선하면서 독립 출처 ID·그림 보존 및 병합 반복 시 중복 방지', () => {
  const external: CalendarEvent = { ...version, id: 'honkai:timeline:9.1:event', kind: 'event', title: '같은 행사',
    crossChecked: true, periodBasis: 'community-data', imageUrls: ['https://example.com/event.png'] };
  const precise = { ...external, id: 'honkai:official:123:item', startAt: '2026-10-22T09:00:00.000Z',
    periodBasis: undefined, imageUrls: undefined };
  const first = mergeHonkaiScheduleSources({ events: [precise], issues: [] }, [external], []);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]!.startAt, precise.startAt);
  assert.equal(first.events[0]!.periodBasis, undefined);
  assert.deepEqual(first.events[0]!.imageUrls, external.imageUrls);
  assert.ok(scheduleIdentifiers(first.events[0]!).includes(external.id));
  const again = mergeHonkaiScheduleSources(first, [external], []);
  assert.equal(again.events.length, 1);
  const differentVersion = { ...external, id: 'honkai:timeline:9.2:event', versionStartId: 'honkai:version:9.2',
    startAt: '2027-01-01T00:00:00.000Z', endAt: '2027-02-01T00:00:00.000Z' };
  assert.equal(mergeHonkaiScheduleSources(first, [differentVersion], []).events.length, 2);
  const original = { ...external, id: 'unknown', title: 'Untranslated Event', crossChecked: false };
  const preserved = mergeHonkaiScheduleSources(first, [original], []);
  assert.equal(preserved.events.length, 2);
  assert.ok(preserved.events.some((event) => event.id === original.id && !event.crossChecked));
});
