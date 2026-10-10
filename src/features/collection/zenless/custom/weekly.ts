import { buildWeeklySchedules } from '../../weekly';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

export const buildZenlessWeeklySchedules = (now = Date.now()) => buildWeeklySchedules({
  game: 'zenless', key: 'bounty-commission', title: '현상금 의뢰',
  sourceUrl: 'https://zenless.hoyoverse.com/ko-kr/', description: '제로 공동: 잃어버린 땅 / 제로 공동: 기이한 미궁의 현상금 의뢰',
  imageUrls: [CUSTOM_SCHEDULE_IMAGES.zenlessWeekly],
}, now);
