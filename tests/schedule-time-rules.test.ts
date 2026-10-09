import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { isCalendarEvent } from '../shared/calendar';
import { reconcileSchedules } from '../src/features/collection';
import { applyScheduleTimeRules } from '../src/features/collection/schedule-time-rules';
import type { CollectionIssue } from '../shared/admin';

const event = (title: string, endAt: string): CalendarEvent => ({ id: title, title, game: 'starrail', kind: 'event',
  startAt: '2032-01-01T03:00:00Z', endAt, description: '', sourceUrl: 'https://example.com/feed', sourceLanguage: 'ko-kr' });

test('별의 선물은 미래 모든 회차에서 종료 날짜를 유지하고 한국 04:59:59 적용', () => {
  for (const title of ['별의 선물', 'Gift of Odyssey']) for (const day of ['2032-02-29', '2032-12-31', '2033-01-01']) {
    const raw = event(title, `${day}T06:59:59+09:00`);
    const result = reconcileSchedules([raw]).events[0]!;
    assert.equal(result.endAt, new Date(`${day}T04:59:59+09:00`).toISOString());
    assert.equal(result.timeEvidence?.end?.basis, 'schedule-rule');
    assert.equal(result.collectionSources?.[0]?.endAt, raw.endAt);
    assert.ok(isCalendarEvent(result));
    assert.deepEqual(reconcileSchedules([result]).events, [result]);
    assert.equal(raw.endAt, `${day}T06:59:59+09:00`);
  }
});

test('미공개 회차·추정 버전 종료는 원래 한국 날짜의 05:00:00으로 통일', () => {
  for (const game of ['genshin', 'starrail', 'zenless', 'wuwa'] as const) for (const hour of ['00', '05', '12', '23']) {
    const raw = { ...event('미공개 종료', `2032-03-01T${hour}:59:59+09:00`), game, periodBasis: 'community-cycle' as const };
    const corrected = reconcileSchedules([raw]).events[0]!;
    assert.equal(corrected.endAt, '2032-02-29T20:00:00.000Z');
    assert.equal(corrected.periodBasis, 'community-cycle');
    assert.deepEqual(reconcileSchedules([corrected]).events, [corrected]);
  }
  for (const basis of ['default-42-days', 'announced-date'] as const) {
    const raw = { ...event('추정 버전', '2032-03-01T12:00:00+09:00'), kind: 'version' as const, versionEndBasis: basis };
    assert.equal(applyScheduleTimeRules(raw).endAt, '2032-02-29T20:00:00.000Z');
  }
});

test('공개 종료·무관한 콘텐츠·다른 게임은 종료 규칙으로 변경하지 않음', () => {
  for (const raw of [event('공개 무기고', '2032-03-01T12:59:00+09:00'), event('별의 선물 추가 보상', '2032-03-01T06:59:59+09:00'),
    { ...event('별의 선물', '2032-03-01T06:59:59+09:00'), game: 'genshin' as const }]) {
    assert.deepEqual(applyScheduleTimeRules(raw), raw);
  }
});

test('엔드필드는 미공개 무기고와 추정 버전도 05시 기본 규칙에서 제외', () => {
  const weapon = { ...event('「새 무기」 무기고 신청', '2032-03-01T12:59:00+09:00'), game: 'endfield' as const,
    kind: 'banner' as const, periodBasis: 'community-cycle' as const };
  assert.deepEqual(applyScheduleTimeRules(weapon), weapon);
  for (const basis of ['default-42-days', 'announced-date'] as const) {
    const version = { ...event('엔드필드 새 버전', '2032-03-01T13:00:00+09:00'), game: 'endfield' as const,
      kind: 'version' as const, versionEndBasis: basis };
    assert.deepEqual(applyScheduleTimeRules(version), version);
  }
});

test('새로 공개된 공식 종료와 수동 지정은 종료 기본 규칙보다 우선', () => {
  for (const basis of ['official', 'manual'] as const) {
    const raw = { ...event('별의 선물', '2032-03-01T12:30:00+09:00'), periodBasis: 'community-cycle' as const,
      timeEvidence: { end: { at: '2032-03-01T12:30:00+09:00', basis, precision: 'minute' as const, sourceUrl: 'https://example.com/official' } } };
    assert.deepEqual(applyScheduleTimeRules(raw), raw);
  }
  const raw = { ...event('새로운 무기고', '2032-03-01T06:59:59+09:00'), identityKey: 'weapon-cycle', periodBasis: 'community-cycle' as const };
  const first = reconcileSchedules([raw]).events[0]!;
  const notice = { ...raw, id: 'official', periodBasis: undefined, endAt: '2032-03-01T12:59:00+09:00',
    sourceUrl: 'https://example.com/official', timeEvidence: { end: { at: '2032-03-01T12:59:00+09:00', basis: 'official' as const, precision: 'minute' as const, sourceUrl: 'https://example.com/official' } } };
  const result = reconcileSchedules([first, notice]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.endAt, notice.endAt);
  assert.equal(result.events[0]?.timeEvidence?.end?.basis, 'official');
});

test('종료 규칙으로 기간이 역전되면 자동 날짜 이동 없이 원본 유지와 확인 항목 생성', () => {
  const raw = { ...event('미공개', '2032-03-01T12:59:00+09:00'), startAt: '2032-03-01T06:00:00+09:00', periodBasis: 'community-cycle' as const };
  const issues: CollectionIssue[] = [];
  assert.deepEqual(applyScheduleTimeRules(raw, issues), raw);
  assert.equal(issues.length, 1);
});
