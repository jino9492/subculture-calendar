import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { supplementHoyoCalendar } from '../src/features/collection/hoyo/announcements';
import { reconcileSchedules } from '../src/features/collection/reconciliation';

const sourceUrl = 'https://example.com/notice';
const native = (title: string, endAt: string): CalendarEvent => ({
  id: `genshin:${title}`, game: 'genshin', kind: 'event', title,
  startAt: '2026-10-12T02:00:00.000Z', endAt, description: '구조화 이벤트 설명',
  sourceUrl: 'https://example.com/calendar', sourceLanguage: 'ko-kr', collectionMethod: 'structured',
  localizationKey: `hoyo:genshin:events:ActTypeOther:${title}`,
});
const collect = (events: CalendarEvent[], description: string, title = '「승부 예측의 달인」 이벤트: 전투 승패 예측') =>
  supplementHoyoCalendar('genshin', { events, issues: [], skipped: 0 }, [{ id: 'test', title, description, url: sourceUrl }], []);
const phases = '〓이벤트 기간〓\n대회 진행 기간: 2026/10/12 11:00 (KST) ~ 2026/10/20 10:59 (KST)\n결과 발표 기간: 2026/10/20 11:00 (KST) ~ 2026/10/23 10:59 (KST)';

test('원신의 공지 세부 단계는 전체 기간이 일치하는 구조화 이벤트 한 건으로 보완하고 이미지 유무에 무관', () => {
  for (const imageUrls of [undefined, ['https://example.com/event.png']]) {
    const event = { ...native('승부 예측의 달인', '2026-10-23T01:59:59.000Z'), imageUrls };
    const input = structuredClone(event);
    const result = collect([event], phases);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.id, event.id);
    assert.deepEqual(result.events[0]?.imageUrls, imageUrls);
    assert.match(result.events[0]!.description, /대회 진행 기간/);
    assert.match(result.events[0]!.description, /결과 발표 기간/);
    assert.equal(result.events[0]?.collectionSources?.length, 2);
    assert.deepEqual(event, input);
    assert.deepEqual(collect(result.events, phases).events, result.events);
    assert.deepEqual(reconcileSchedules(result.events).events, result.events);
  }
});

test('원신의 전체 개방 기간 안의 폭주 단계도 별도 이벤트로 추가하지 않음', () => {
  const event = native('지맥 제압전', '2026-11-02T19:59:59.000Z');
  const description = '이벤트 기간\n콘텐츠 개방 기간: 2026/10/12 11:00 (KST) ~ 2026/11/03 04:59 (KST)\n혼란 폭주 기간: 2026/10/12 11:00 (KST) ~ 2026/10/22 04:59 (KST)';
  const result = collect([event], description, '「지맥 제압전」 이벤트: 혼돈의 지맥을 향한 도전');
  assert.equal(result.events.length, 1);
  assert.match(result.events[0]!.description, /혼란 폭주 기간/);
});

test('구조화 이벤트가 없거나 이름·전체 기간이 다르거나 후보가 여러 개면 세부 일정을 보존', () => {
  const event = native('승부 예측의 달인', '2026-10-23T01:59:59.000Z');
  for (const events of [[], [native('다른 이벤트', event.endAt)], [{ ...event, endAt: '2026-10-18T02:00:00.000Z' }],
    [event, { ...event, id: 'another', localizationKey: 'hoyo:genshin:events:ActTypeOther:another' }]]) {
    const result = collect(events, phases);
    assert.ok(result.events.some((row) => row.title.endsWith(' · 대회 진행')));
    assert.ok(result.events.some((row) => row.title.endsWith(' · 결과 발표')));
  }
});

test('일곱 성인의 소환 공지 접두어를 콘텐츠 이름에서 분리해 동일 일정으로 병합', () => {
  const event = native('격투 모드: 자동 대전', '2026-10-25T19:59:59.000Z');
  const result = collect([event], '이벤트 기간\n2026/10/12 11:00 (KST) ~ 2026/10/26 04:59 (KST)', '「일곱 성인의 소환」 격투 모드: 자동 대전');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.id, event.id);
  assert.equal(result.events[0]?.collectionSources?.length, 2);
});
