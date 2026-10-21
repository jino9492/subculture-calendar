const VERSION_LABELS: Record<string, [string, string][]> = {
  '9.1': [
    ['7-Day Login: 120 crystals, HoTime stigma box, and mats', '성화의 여정~ 가을밤의 인연'],
    ['7-Day Login: Emblem, 10 Equip Card, Stigma Upgrade', '꿈을 줍는 여정'],
    ['Free JD / Lantern / Thelema Select + 10th Anniversary Cake', '꿈에서 온 선물'],
    ['Free Weapon Select (v7.3-8.1 including DLC), JD / Lantern / Thel Outfit Select and mats', '달콤한 모래사장'],
    ['Raffle (Merch, Valk Box, Weapon Box, BP Pass)', '은빛 바다의 추억'],
    ['Free Sena / Lunar Vow and 15 Cards', '단풍빛 불꽃~ 가을 야유회'],
    ['P2 Epilogue', '바다가 불꽃의 소리로 노래하고 있어'],
    ['Time Capsule', '타임캡슐'],
  ],
};

export const honkaiTimelineLabels = (version: string) => VERSION_LABELS[version] ?? [];
