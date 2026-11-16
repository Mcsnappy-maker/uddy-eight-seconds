export interface PartnerLogoConfig {
  id: string;
  order: number;
  file: string;
  accessibleName: string;
  optionalUrl?: string;
  enabled: boolean;
}

export const PARTNER_LOGOS_CONFIG: readonly PartnerLogoConfig[] = [
  {
    id: 'scottish_hockey',
    order: 1,
    file: './assets/branding/sponsor_scottish_hockey.png',
    accessibleName: 'Scottish Hockey',
    enabled: true,
  },
  {
    id: 'wallace_whittle',
    order: 2,
    file: './assets/branding/sponsor_wallace_whittle.png',
    accessibleName: 'Wallace Whittle',
    enabled: true,
  },
  {
    id: 'drone_scotland',
    order: 3,
    file: './assets/branding/sponsor_drone_scotland.png',
    accessibleName: 'Drone Scotland',
    enabled: true,
  },
  {
    id: 'uddy_tv',
    order: 4,
    file: './assets/branding/sponsor_uddy_tv.png',
    accessibleName: 'Uddy TV',
    enabled: true,
  },
  {
    id: 'tunnocks',
    order: 5,
    file: './assets/branding/sponsor_tunnocks.png',
    accessibleName: "Tunnock's",
    enabled: true,
  },
  {
    id: 'perfect_glazing',
    order: 6,
    file: './assets/branding/sponsor_perfect_glazing.png',
    accessibleName: 'Perfect Glazing',
    enabled: true,
  },
  {
    id: 'deans_civil_engineering',
    order: 7,
    file: './assets/branding/sponsor_deans.png',
    accessibleName: 'Deans Civil Engineering',
    enabled: true,
  },
];

export function getOrderedPartnerLogos(
  customList: readonly PartnerLogoConfig[] = PARTNER_LOGOS_CONFIG,
): PartnerLogoConfig[] {
  return customList
    .filter((entry) => entry.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
}
