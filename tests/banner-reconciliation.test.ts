import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_IDS, isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { reconcileSchedules, resolveScheduleId } from '../src/features/collection';
import { mergeManagedEvents } from '../server/admin-store';

const banner = (id: string, title: string): CalendarEvent => ({ id, title, game: 'endfield', kind: 'banner',
  startAt: '2099-01-01T03:00:00Z', endAt: '2099-02-01T03:00:00Z', sourceUrl: `https://example.com/${id}`,
  sourceLanguage: 'ko-kr', collectionMethod: 'announcement', description: '', imageUrls: ['https://example.com/common.png'] });

test('엔필 실제 재구축 공지 중복 병합 및 캐릭터·무기 픽업 분리', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('./fixtures/endfield-reconstruction-banners.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.every(isCalendarEvent));
  assert.equal(raw.length, 3);
  const result = reconcileSchedules(raw);
  assert.equal(result.events.length, 2);
  const weapon = result.events.find((event) => event.title.includes('점묘 신청'));
  assert.ok(weapon);
  assert.equal(weapon.collectionSources?.length, 2);
  assert.equal(weapon.title, '「점묘 신청」 재구축 신청#1');
  assert.ok(weapon.imageUrls?.length);
  assert.equal(result.events.filter((event) => event.title.includes('찬란한 색채')).length, 1);
  assert.deepEqual(reconcileSchedules([...raw].reverse()), result);
  assert.deepEqual(reconcileSchedules(result.events), result);
  const original = raw.find((event) => event.title.endsWith(' 개방'));
  assert.ok(original);
  assert.equal(resolveScheduleId(result.events, original.id), weapon.id);
  assert.equal(mergeManagedEvents(result.events, { reviews: {}, overrides: {
    [original.id]: { event: original, hidden: false },
  } }).length, 2);
});

test('새 이름과 모든 게임의 픽업 안내 문구를 병합하되 종류·회차·주기는 보존', () => {
  const types = ['기원', '워프', '채널', '튜닝', '헤드헌팅', '신청'];
  for (const game of GAME_IDS) for (const type of types) for (let index = 0; index < 5; index++) {
    const title = `「새로 추가된 픽업 ${index}」 ${type}#1`;
    const primary = { ...banner('primary', title), game };
    const notices = ['개방', '개방 안내', '안내', '오픈'].map((suffix, i) => ({ ...banner(`notice-${i}`, `${title} ${suffix}`), game }));
    const nextRound = { ...banner('round-two', title.replace('#1', '#2')), game };
    const otherType = { ...banner('other-type', `「새로 추가된 픽업 ${index}」 ${type === '신청' ? '헤드헌팅' : '신청'}#1`), game };
    const nextCycle = { ...primary, id: 'next-cycle', startAt: primary.endAt, endAt: '2099-03-01T03:00:00Z' };
    const candidates = [primary, ...notices, nextRound, otherType, nextCycle];
    const result = reconcileSchedules(candidates);
    assert.equal(result.events.length, 4);
    assert.equal(result.events.find((event) => event.id === primary.id)?.collectionSources?.length, 5);
    assert.deepEqual(reconcileSchedules([...candidates].reverse()), result);
    assert.deepEqual(reconcileSchedules(result.events), result);
  }
});

test('이름 자체의 개방 문구·별도 활동과 같은 이미지를 쓰는 다른 픽업은 보존', () => {
  const candidates = [banner('a', '「새로운 개방」 재구축 신청#1'), banner('b', '「다른 개방」 재구축 신청#1'),
    banner('c', '「새로운 개방」 재구축 신청#1 · 보너스 개방'), banner('d', '개방 안내')];
  assert.equal(reconcileSchedules(candidates).events.length, 4);
});
