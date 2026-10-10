import { buildWeeklySchedules } from '../../weekly';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

export const buildStarrailWeeklySchedules = (now = Date.now()) => buildWeeklySchedules({
  game: 'starrail', key: 'weekly-rewards', title: '차분화 우주 / 화폐전쟁',
  sourceUrl: 'https://hsr.hoyoverse.com/ko-kr/', description: '차분화 우주 / 화폐전쟁 주간 보상',
  imageUrls: [CUSTOM_SCHEDULE_IMAGES.starrailWeekly],
}, now);
