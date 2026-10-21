import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { collectHonkaiOfficialItems, resolveHonkaiOfficialItems, preserveHonkaiReferences } from '../src/features/collection/honkai/official';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';
import { scheduleIdentifiers } from '../shared/schedule-reference';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/honkai-9.1-events.json', import.meta.url), 'utf8'));
const version: CalendarEvent = { id: 'honkai:version:9.1', title: '9.1 버전', game: 'honkai', kind: 'version',
  startAt: '2026-10-22T08:00:00.000Z', endAt: '2026-12-23T15:00:00.000Z', sourceLanguage: 'ko-kr',
  sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865', description: '',
  timeEvidence: { start: { at: '2026-10-22T08:00:00.000Z', basis: 'official', precision: 'minute',
    sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865' } } };
const detail = (description: string, overrides: Partial<HonkaiArticle> = {}): HonkaiArticle => ({ id: 'new-detail',
  title: '「달콤한 모래사장」 이벤트 안내', url: 'https://www.hoyolab.com/article/999999',
  createdAt: Date.parse('2026-10-22T03:00:00Z') / 1000, description, ...overrides });

test('외부 데이터와 약칭 사전 없이 공식 9.1 목록 10개 보존 및 기간 미확정은 관리자에 유지', () => {
  const items = collectHonkaiOfficialItems([fixture.article], [version]);
  assert.equal(items.length, 10);
  assert.ok(items.some((item) => item.title === '축제 누적 소모'));
  assert.ok(items.some((item) => item.title === '늦가을의 빛'));
  assert.ok(items.some((item) => item.title === '꿈에서 온 선물'));
  const result = resolveHonkaiOfficialItems(items, []);
  assert.equal(result.events.length, 0);
  assert.equal(result.issues.length, 10);
  assert.ok(result.issues.every((issue) => issue.sourceUrl === fixture.article.url && issue.id.includes('honkai:official:')));
  const opening = items.find((item) => item.title === '바다가 불꽃의 소리로 노래하고 있어')!.opening!;
  assert.equal(opening.at, '2026-11-01T15:00:00.000Z');
});

test('뒤늦은 한국어 상세 기간을 공식 목록에 병합하고 ID와 관리자 항목 키 유지', () => {
  const before = collectHonkaiOfficialItems([fixture.article], [version]);
  const notice = detail('☆☆테마 이벤트 「달콤한 모래사장」☆☆\n이벤트 기간: 10월 22일 17:00 ~ 12월 24일 04:00');
  const parsed = parseHonkaiSchedules([notice]);
  const after = collectHonkaiOfficialItems([notice, fixture.article], [version, ...parsed.events]);
  assert.equal(after.length, before.length);
  const result = resolveHonkaiOfficialItems(after, []);
  assert.equal(result.events.length, 1);
  const event = result.events[0]!;
  assert.ok(isCalendarEvent(event));
  assert.equal(event.id, before.find((item) => item.title === '달콤한 모래사장')!.id);
  assert.equal(event.sourceUrl, fixture.article.url);
  assert.equal(event.endAt, '2026-12-23T19:00:00.000Z');
  assert.equal(event.timeEvidence?.end?.sourceUrl, notice.url);
  assert.equal(result.issues.length, 9);
});

test('상대 기간·장비 및 캐릭터 기간·보상 수령 기한을 구분하고 다른 회차 충돌은 보류', () => {
  const notice = detail('9.1 버전 업데이트 후~12월 4일 12:00 기간 「시간의 율자」 캐릭터 보급 개방.\n'
    + '9.1 버전 업데이트 후~12월 4일 12:00 기간 「시간의 율자」 추천 장비 보급 추가.\n'
    + '수령 기간: 9.1 버전 업데이트 후~11월 5일 04:00', { title: '신규 캐릭터 「시간의 율자」 정보' });
  const result = resolveHonkaiOfficialItems(collectHonkaiOfficialItems([notice], [version]), []);
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every((event) => event.kind === 'banner' && event.startAt === version.startAt
    && event.endAt === '2026-12-04T03:00:00.000Z'));
  const conflict = detail('☆☆테마 이벤트 「달콤한 모래사장」☆☆\n이벤트 기간: 10월 23일 10:00 ~ 11월 4일 04:00\n'
    + '이벤트 기간: 11월 23일 10:00 ~ 12월 4일 04:00');
  const items = collectHonkaiOfficialItems([fixture.article, conflict], [version]);
  assert.equal(resolveHonkaiOfficialItems(items, []).events.length, 0);
  assert.ok(resolveHonkaiOfficialItems(items, []).issues.some((issue) => issue.reason.includes('충돌')));
});

test('새 이름의 외부 기간은 직접 대조 때만 보완하고 외부 전용 항목은 공식 목록에 추가하지 않음', () => {
  const notice = detail('9.1 버전\n☆☆테마 이벤트 「새 이름」☆☆\n10월 29일, 「새 이름」 이벤트 개방.', {
    englishDescription: '☆☆ Featured Event "Brand New Name" ☆☆' });
  const raw = { ...fixture.timeline, scheduleActivities: [{ row: 'EVENT 1', content: [
    { startWeek: 2, endWeek: 4, miniature: { titleTop: 'Brand New Name' } },
    { startWeek: 2, endWeek: 4, miniature: { titleTop: 'Free Unknown Rewards' } }] }] };
  const supplemental = parseHonkaiPublicTimeline(raw, version, [notice], fixture.article.url, false);
  const inventory = collectHonkaiOfficialItems([notice], [version]);
  const result = resolveHonkaiOfficialItems(inventory, supplemental.events);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]!.title, '새 이름');
  assert.ok(result.events[0]!.id.startsWith('honkai:official:'));
  assert.equal(applyHonkaiTimeRules([version, ...result.events])[1]!.startAt, '2026-10-28T19:00:00.000Z');
  const knownAlias = { ...raw, scheduleActivities: [{ row: 'EVENT 1', content: [
    { startWeek: 1, endWeek: 10, miniature: { titleTop: 'Free JD / Lantern / Thelema Select + 10th Anniversary Cake' } }] }] };
  const original = parseHonkaiPublicTimeline(knownAlias, version, [fixture.article], fixture.article.url, false).events[0]!;
  assert.equal(original.title, 'Free JD / Lantern / Thelema Select + 10th Anniversary Cake');
  assert.equal(original.crossChecked, false);
});

test('ID 교체 시 같은 회차만 완료·보정 별칭 승계하며 이전 기간·다음 회차는 유입 차단', () => {
  const previous = { ...version, id: 'honkai:timeline:9.1:old', kind: 'event' as const, title: '같은 행사' };
  const current = { ...previous, id: 'honkai:official:123:new', identityKey: 'honkai:official:123:new' };
  const [event] = preserveHonkaiReferences([previous], [current]);
  assert.ok(scheduleIdentifiers(event!).includes(previous.id));
  assert.equal(event!.startAt, current.startAt);
  const later = { ...current, startAt: '2027-10-22T08:00:00.000Z', endAt: '2027-12-23T15:00:00.000Z' };
  assert.equal(preserveHonkaiReferences([previous], [later])[0]!.collectionSources, undefined);
});

test('개별 공지 제목의 인게임 추첨 이벤트도 수집하고 댓글 추첨과 구분', () => {
  const notice = detail('이벤트 기간: 10월 22일 17:00 ~ 12월 24일 04:00', {
    title: '「은빛 바다의 추억」 추첨 이벤트 안내' });
  const result = resolveHonkaiOfficialItems(collectHonkaiOfficialItems([fixture.article, notice], [version]), []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]!.title, '은빛 바다의 추억');
  const community = { ...notice, title: '「은빛 바다의 추억」 댓글 추첨 이벤트' };
  assert.equal(collectHonkaiOfficialItems([community], [version]).length, 0);
});

test('캐릭터 소개의 성흔·무기 보상명을 이벤트로 만들지 않고 장비 보급 기간 유지', () => {
  for (const [character, reward] of [['시간의 율자', '시간의 이름'], ['새 캐릭터', '새 성흔']]) {
    const notice = detail(`☆☆☆☆☆${character}☆☆☆☆☆\n◆ 장비 획득\n`
      + `9.1 버전 업데이트 후~12월 4일 12:00 기간, 「${character}」 추천 조합: 드라이브 코어 무기 「새 무기」, 「${reward}」 성흔 세트 장비 보급 추가.\n`
      + `9.1 버전 업데이트 후~12월 24일 04:00 기간, 로그인 이벤트 참여 시 「${reward}」 성흔 선택 상자×1를 획득하고, 사용 시 「${character}」 추천 성흔 중 1개를 획득할 수 있어.`,
    { title: `신규 S급 캐릭터 「${character}」 등장` });
    const inventory = collectHonkaiOfficialItems([notice], [version]);
    assert.ok(!inventory.some((item) => item.title === reward));
    const result = resolveHonkaiOfficialItems(inventory, []);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.title, `${character} · 장비 보급`);
    assert.equal(result.events[0]!.endAt, '2026-12-04T03:00:00.000Z');
    assert.ok(!result.events.some((event) => event.kind === 'event'));
  }
});

test('보상 문장의 이름을 쓰지 않고 명시된 이벤트 제목의 공식 기간만 연결', () => {
  const notice = detail('☆☆로그인 이벤트 「진짜 로그인」☆☆\n'
    + '이벤트 기간: 10월 22일 17:00~12월 24일 04:00\n'
    + '9.1 버전 업데이트 후~12월 24일 04:00 기간, 로그인 이벤트 참여 시 「보상 성흔」 선택 상자 획득.');
  const result = resolveHonkaiOfficialItems(collectHonkaiOfficialItems([notice], [version]), []);
  assert.ok(result.events.some((event) => event.title === '진짜 로그인'));
  assert.ok(!result.events.some((event) => event.title === '보상 성흔'));
});
