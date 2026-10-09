import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarResponse, type CollectedCalendar, type SourceStatus } from '../shared/calendar';
import { isAdminResponse } from '../shared/admin';
import { toPublicCalendar } from '../server/public-calendar';

const source: SourceStatus = { game: 'genshin', state: 'ok', fetchedAt: '2026-10-09T00:00:00.000Z',
  message: '관리자 전용 파싱 진단', skipped: 10 };
const collected = (sources: SourceStatus[]): CollectedCalendar => ({ events: [], sources, server: 'Asia', displayTimeZone: 'Asia/Seoul' });

test('공개 응답은 수집 상태를 제외하고 관리자 응답은 유지', () => {
  const calendar = collected([source]);
  const response = toPublicCalendar(calendar, []);
  assert.deepEqual(Object.keys(response).sort(), ['displayTimeZone', 'events', 'server', 'status', 'updatedAt']);
  assert.ok(!JSON.stringify(response).includes(source.message));
  assert.ok(isCalendarResponse(response));
  assert.equal(isCalendarResponse(calendar), false);
  assert.ok(isAdminResponse({ ...calendar, collectedEvents: [], issues: [], management: { reviews: {}, overrides: {} } }));
  assert.equal(isAdminResponse({ ...response, collectedEvents: [], issues: [], management: { reviews: {}, overrides: {} } }), false);
});

test('일정이 없어도 정상 수집 및 확인 필요 상태는 공개 오류로 표시하지 않음', () => {
  assert.equal(toPublicCalendar(collected([source]), []).status, 'ok');
  assert.equal(toPublicCalendar(collected([{ ...source, state: 'partial' }]), []).status, 'ok');
});

test('이전 데이터와 부분 장애는 일반 안내, 모든 수집 실패는 불러오기 실패', () => {
  assert.equal(toPublicCalendar(collected([{ ...source, state: 'stale' }]), []).status, 'stale');
  assert.equal(toPublicCalendar(collected([source, { ...source, game: 'starrail', state: 'error', fetchedAt: null }]), []).status, 'stale');
  const unavailable = toPublicCalendar(collected([{ ...source, state: 'error', fetchedAt: null }]), []);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.updatedAt, null);
});

test('혼합 캐시는 가장 오래된 데이터 기준 갱신 시각 표시 및 응답 검증', () => {
  const response = toPublicCalendar(collected([source, { ...source, game: 'starrail', state: 'stale', fetchedAt: '2026-10-08T00:00:00.000Z' }]), []);
  assert.equal(response.updatedAt, '2026-10-08T00:00:00.000Z');
  assert.equal(isCalendarResponse({ ...response, updatedAt: 'invalid' }), false);
  assert.equal(isCalendarResponse({ ...response, status: 'partial' }), false);
});
