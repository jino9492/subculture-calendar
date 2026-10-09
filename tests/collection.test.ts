import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWuwaChallengeCycles, updateWuwaChallengeEnds, parseWuwaNaverFeed, parseWuwaKoreanEvents } from '../src/features/collection';

test('공식 라운지 게임 관리자 글의 스마트에디터 문단만 읽고 일반 사용자 글 제외', () => {
  const feed = { feed: { loungeId: 'WutheringWaves', feedId: 8258653, title: '[옥궐에 피는 꽃] 무기 이벤트 튜닝', createdDate: '20260929121029',
    contents: JSON.stringify({ document: { components: [{ '@ctype': 'text', value: [
      { nodes: [{ '@ctype': 'textNode', value: '✦이벤트 기간✦' }] },
      { nodes: [{ '@ctype': 'textNode', value: '3.7 버전 업데이트 후 ~ 2026년 10월 22일 10:59' }] },
    ] }, { '@ctype': 'image', src: 'https://example.com/2026.png' }] } }) }, user: { userRoleCode: 'game_manager' } };
  const article = parseWuwaNaverFeed(feed);
  assert.ok(article);
  assert.equal(article.sourceUrl, 'https://game.naver.com/lounge/WutheringWaves/board/detail/8258653');
  assert.equal(parseWuwaNaverFeed({ ...feed, user: { userRoleCode: 'normal' } }), null);
  const parsed = parseWuwaKoreanEvents(article, [{ version: '3.7', startAt: '2026-09-30T03:00:00.000Z', maintenanceStart: '2026-09-29T20:00:00.000Z', sourceUrl: 'https://example.com' }]);
  assert.equal(parsed.events[0]?.endAt, '2026-10-22T01:59:00.000Z');
  assert.equal(parsed.events[0]?.sourceUrl, article.sourceUrl);
});

test('픽업 전체 목록의 공통 기간으로 신규·복각 캐릭터와 무기 6개를 생성', () => {
  const parsed = parseWuwaKoreanEvents({ id: 'overview', title: '3.7 버전 [캐릭터/무기 이벤트 튜닝 · 1차]', content:
    '「부디 이 밤처럼 늘 영원하기를」, 「여명의 지평선」, 「영고성쇠한 달 속을 걷는 나」 캐릭터 이벤트 튜닝, 「옥궐에 피는 꽃」, 「쿠모키리(曇斬)」, 「세상 만물의 진리」 무기 이벤트 튜닝이 한정 오픈됩니다.\n✦이벤트 기간: 2026년 9월 30일 12:00 ~ 2026년 10월 22일 10:59' }, []);
  assert.equal(parsed.events.length, 6);
  assert.equal(parsed.completeBannerPeriods.length, 1);
  assert.equal(parsed.events[0]?.title, '[부디 이 밤처럼 늘 영원하기를] 캐릭터 이벤트 튜닝');
});

test('엔드콘텐츠 세 종류는 직전 종료부터 현재 종료까지이며 Asia 구분과 무효 기간 검증', () => {
  const previousEndTime = Date.parse('2026-10-05T04:00:00+08:00') / 1000;
  const endTime = Date.parse('2026-10-19T04:00:00+08:00') / 1000;
  const data = { server: 'Asia', matrix: { endTime, previousEndTime }, tower: { seasonEndTime: endTime, previousEndTime }, ruins: { seasonEndTime: endTime, previousEndTime } };
  const result = buildWuwaChallengeCycles(data, 'https://example.com/endings');
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0]?.startAt, '2026-10-04T20:00:00.000Z');
  assert.equal(result.events[0]?.endAt, '2026-10-18T20:00:00.000Z');
  assert.equal(buildWuwaChallengeCycles({ server: 'Asia', matrix: { endTime } }, 'https://example.com').events.length, 0);
  assert.throws(() => buildWuwaChallengeCycles({ ...data, server: 'CN' }, 'https://example.com'));
});

test('종료 시각만 기록한 후 갱신 경계를 연속 수집하면 새 주기의 시작을 이전 종료로 연결', () => {
  const boundary = Date.parse('2026-10-19T04:00:00+08:00');
  const first = updateWuwaChallengeEnds({ server: 'Asia', matrix: { endTime: boundary / 1000 } }, undefined, boundary - 60000);
  const next = updateWuwaChallengeEnds({ server: 'Asia', matrix: { endTime: boundary / 1000 + 14 * 86400 } }, first.history, boundary + 60000);
  assert.equal(buildWuwaChallengeCycles(first.current, 'https://example.com').events.length, 0);
  assert.equal(buildWuwaChallengeCycles(next.current, 'https://example.com').events[0]?.startAt, new Date(boundary).toISOString());
  const repeated = updateWuwaChallengeEnds({ server: 'Asia', matrix: { endTime: boundary / 1000 + 14 * 86400 } }, next.history, boundary + 120000);
  assert.deepEqual(buildWuwaChallengeCycles(repeated.current, 'https://example.com').events, buildWuwaChallengeCycles(next.current, 'https://example.com').events);
  const gap = updateWuwaChallengeEnds({ server: 'Asia', matrix: { endTime: boundary / 1000 + 28 * 86400 } }, first.history, boundary + 20 * 86400000);
  assert.equal(buildWuwaChallengeCycles(gap.current, 'https://example.com').events.length, 0);
});
