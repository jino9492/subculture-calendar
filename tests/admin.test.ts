import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAction, isAdminState, type AdminState } from '../shared/admin';
import { type CalendarEvent } from '../shared/calendar';
import { applyAdminAction, mergeManagedEvents } from '../server/admin-store';
import { fromKoreanInput, toKoreanInput } from '../src/features/admin/utils';
import { parseHoyoCalendar } from '../src/features/collection';

const event: CalendarEvent = { id: 'wuwa:test', game: 'wuwa', kind: 'event', title: '원문 제목', startAt: '2026-10-08T00:00:00.000Z',
  endAt: '2026-10-15T00:00:00.000Z', sourceUrl: 'https://example.com/news', description: '', sourceLanguage: 'en' };
const empty = (): AdminState => ({ reviews: {}, overrides: {} });

test('보정·수동 추가·숨김을 원본에 반영하고 보정 해제 시 원본 복원', () => {
  const corrected = { ...event, title: '한국어 제목', sourceLanguage: 'ko-kr' };
  let state = applyAdminAction(empty(), { action: 'save', event: corrected, hidden: false, issueId: 'translation', note: '공식 확인' });
  assert.equal(mergeManagedEvents([event], state)[0]?.title, corrected.title);
  assert.equal(state.reviews.translation?.status, 'resolved');
  state = applyAdminAction(state, { action: 'save', event: corrected, hidden: true, note: '' });
  assert.equal(mergeManagedEvents([event], state).length, 0);
  state = applyAdminAction(state, { action: 'reset', id: event.id });
  assert.equal(mergeManagedEvents([event], state)[0]?.title, event.title);
  state = applyAdminAction(state, { action: 'save', event: { ...event, id: 'manual:one' }, hidden: false, note: '' });
  assert.equal(mergeManagedEvents([event], state).length, 2);
  state = applyAdminAction(state, { action: 'reset', id: 'manual:one' });
  assert.equal(mergeManagedEvents([event], state).length, 1);
});
test('처리 기록 재개와 프로토타입 키를 포함한 저장 검증', () => {
  let state = applyAdminAction(empty(), { action: 'review', id: '__proto__', status: 'resolved', note: '확인' });
  assert.ok(Object.hasOwn(state.reviews, '__proto__'));
  assert.ok(isAdminState(JSON.parse(JSON.stringify(state))));
  state = applyAdminAction(state, { action: 'review', id: '__proto__', status: 'pending', note: '' });
  assert.ok(!Object.hasOwn(state.reviews, '__proto__'));
  assert.equal(Object.getPrototypeOf(state.reviews), Object.prototype);
});
test('관리 API 입력은 기간·분류·제목·크기·출처 검증', () => {
  const action = { action: 'save', event, hidden: false, note: '' };
  assert.ok(isAdminAction(action));
  assert.ok(!isAdminAction({ ...action, event: { ...event, endAt: event.startAt } }));
  assert.ok(!isAdminAction({ ...action, event: { ...event, sourceUrl: 'javascript:alert(1)' } }));
  assert.ok(!isAdminAction({ ...action, event: { ...event, sourceUrl: 'https://' } }));
  assert.ok(!isAdminAction({ ...action, event: { ...event, kind: 'unknown' } }));
  assert.ok(!isAdminAction({ ...action, event: { ...event, title: ' ' } }));
  assert.ok(!isAdminAction({ ...action, note: 'x'.repeat(3001) }));
});
test('한국 시간 입력을 브라우저 시간대와 무관하게 변환하고 잘못된 날짜 거부', () => {
  assert.equal(toKoreanInput(event.startAt), '2026-10-08T09:00:00');
  assert.equal(fromKoreanInput('2026-10-08T09:00'), event.startAt);
  assert.equal(fromKoreanInput('2026-10-08T09:00:01'), '2026-10-08T00:00:01.000Z');
  assert.equal(fromKoreanInput('2026-02-30T09:00'), null);
  assert.equal(fromKoreanInput('invalid'), null);
});
test('누락된 호요 일정은 원문·제목을 가진 개별 확인 항목으로 제공', () => {
  const result = parseHoyoCalendar('genshin', { events: [{ id: 7, name: '기간 없는 이벤트', start_time: null, end_time: null, description: '<p>원문 설명</p>' }], banners: [], challenges: [] }, 'https://example.com/calendar');
  assert.equal(result.skipped, 1);
  assert.equal(result.issues[0]?.title, '기간 없는 이벤트');
  assert.equal(result.issues[0]?.excerpt, '원문 설명');
});
