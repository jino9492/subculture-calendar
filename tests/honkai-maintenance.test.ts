import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarEvent } from '../shared/calendar';
import { parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';

const maintenance: HonkaiArticle = { id: '47081097', title: '9.1 버전 점검 공지, 신규 이벤트 예고',
  url: 'https://www.hoyolab.com/article/47081097', createdAt: Date.parse('2026-10-14T10:00:01Z') / 1000,
  description: '10월 22일 11:00~17:00(UTC+9)에 업데이트 점검에 들어갈 예정이야.\n'
    + '신규 S급 캐릭터 「시간의 율자」 등장! 테마 이벤트 「만남♪ 추억의 장난감 집」 Coming Soon!\n'
    + '수령 기간: 9.1 버전 업데이트 후~11월 5일 04:00' };
const source = 'https://www.arustats.com/en-us/hi3/timeline/9.1';
const timeline = { version: '9.1', scheduleDates: [{ startDate: '2026-10-22 0:0:0', endDate: '2026-12-24 0:0:0' }],
  scheduleActivities: [
    { row: 'BATTLESUIT SUPPLY A', content: [{ startWeek: 1, endWeek: 2, miniature: { titleTop: 'Herrscher of Time' } }] },
    { row: 'EVENT 1', content: [{ startWeek: 1, endWeek: 2, miniature: { titleTop: 'Encounter♪ Memory of the Toy House' } }] },
    { row: 'EVENT 2', content: [{ startWeek: 1, endWeek: 2, miniature: { titleTop: 'Unknown event' } }] },
  ] };

test('점검 공지만으로 버전 생성하고 보상 수령 기한은 버전 종료에서 제외', () => {
  const [version] = parseHonkaiSchedules([maintenance]).events;
  assert.ok(version && isCalendarEvent(version));
  assert.equal(version.id, 'honkai:version:9.1');
  assert.equal(version.startAt, '2026-10-22T08:00:00.000Z');
  assert.equal(version.endAt, '2026-12-03T08:00:00.000Z');
  assert.equal(version.versionEndBasis, 'default-42-days');
  assert.equal(version.timeEvidence?.start?.basis, 'official');
  assert.equal(parseHonkaiSchedules([{ ...maintenance, description: maintenance.description.replace('UTC+9', 'UTC+8') }]).events.length, 0);
});

test('공식 시작과 일치하는 공개 기간으로 보완하고 미확인 이벤트도 원문 보존', () => {
  const version = parseHonkaiSchedules([maintenance]).events[0]!;
  const result = parseHonkaiPublicTimeline(timeline, version, [maintenance], source);
  assert.equal(version.versionEndBasis, 'default-42-days');
  assert.equal(result.version.endAt, '2026-12-23T15:00:00.000Z');
  assert.equal(result.version.versionEndBasis, undefined);
  assert.equal(result.version.periodBasis, 'community-data');
  assert.equal(result.version.crossChecked, true);
  assert.equal(result.version.timeEvidence?.end?.sourceUrl, source);
  assert.equal(result.events.length, 3);
  assert.equal(result.events.find((event) => event.title === 'Unknown event')!.crossChecked, false);
  const corrected = applyHonkaiTimeRules([result.version, ...result.events]);
  assert.ok(corrected.every(isCalendarEvent));
  assert.ok(corrected.every((event) => event.startAt === version.startAt));
  assert.ok(corrected.every((event) => event.periodBasis === 'community-data'));
  assert.equal(corrected[0]!.endAt, '2026-12-24T02:00:00.000Z');
  assert.ok(result.issues.some((issue) => issue.title === 'Unknown event'));
  assert.throws(() => parseHonkaiPublicTimeline({ ...timeline, version: '9.2' }, version, [maintenance], source));
  for (const startDate of ['2026-10-23 0:0:0', '2026-10-22 0:0:0']) {
    const mismatched = parseHonkaiPublicTimeline({ ...timeline,
      scheduleDates: [{ startDate, endDate: '2027-12-24 0:0:0' }] }, version, [maintenance], source);
    assert.equal(mismatched.events.length, 3);
    assert.equal(mismatched.version.endAt, version.endAt);
    assert.ok(mismatched.events.every((event) => !event.crossChecked && !event.versionStartId));
    assert.ok(mismatched.issues.some((issue) => issue.id.endsWith(':region')));
  }
});

test('뒤늦은 공식 버전 기간 우선 및 다음 점검의 실제 시작으로 이전 버전 종료', () => {
  const update = { ...maintenance, id: 'update', title: '9.1 버전 업데이트 공지',
    description: '9.1 버전에 온 걸 환영해 (10월 22일~12월 24일)!' };
  const versions = parseHonkaiSchedules([maintenance, update]).events;
  assert.equal(versions.length, 1);
  assert.equal(versions[0]!.versionEndBasis, 'announced-date');
  assert.equal(parseHonkaiPublicTimeline(timeline, versions[0]!, [maintenance], source).version.periodBasis, undefined);
  const mismatched = parseHonkaiPublicTimeline({ ...timeline,
    scheduleDates: [{ startDate: '2026-10-22 0:0:0', endDate: '2026-12-31 0:0:0' }] }, versions[0]!, [maintenance], source);
  assert.equal(mismatched.version.endAt, versions[0]!.endAt);
  assert.ok(mismatched.events.every((event) => !event.crossChecked));
  const next = { ...maintenance, id: 'next', title: '9.2 버전 점검 공지',
    description: '12월 24일 10:30~18:00(UTC+9)에 업데이트 점검에 들어갈 예정이야.' };
  for (const articles of [[maintenance, next], [update, maintenance, next], [update, { ...update, id: 'cafe-update' }, maintenance, next]]) {
    const previous = parseHonkaiSchedules(articles).events.find((event) => event.id === 'honkai:version:9.1')!;
    assert.equal(previous.versionEndBasis, 'next-maintenance');
    assert.equal(applyHonkaiTimeRules([previous])[0]!.endAt, '2026-12-24T01:30:00.000Z');
  }
  const revised = { ...maintenance, id: 'revised', createdAt: maintenance.createdAt + 1,
    description: maintenance.description.replace('17:00', '18:00') };
  assert.equal(parseHonkaiSchedules([revised, maintenance]).events[0]!.startAt, '2026-10-22T09:00:00.000Z');
});
