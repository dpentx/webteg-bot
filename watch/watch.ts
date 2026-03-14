// watch/watch.ts
// Takip edilecek Weblate projelerinin listesi

export interface WatchedProject {
  slug: string;        // Weblate'teki proje slug'ı (URL'den)
  displayName: string; // Telegram mesajlarında görünecek isim
  emoji?: string;      // Proje için özel emoji (opsiyonel)
}

/**
 * Takip edilen projeler
 */
export const watchedProjects: WatchedProject[] = [
  {
    slug: 'metrolist',
    displayName: 'Metrolist',
    emoji: '🚇'
  },

  {
    slug: 'cloudstream',
    displayName: 'CloudStream',
    emoji: ''
  },
 
  {
    slug: 'encore-tweaks',
    displayName: 'Encore Tweaks',
    emoji: ''
  },
 
  {
    slug: 'neo-backup',
    displayName: 'Neo Backup',
    emoji: ''
  },

  {
    slug: 'gaphor',
    displayName: 'Gaphor',
    emoji: ''
  },
  
  {
    slug: 'mihon',
    displayName: 'Mihon',
    emoji: ''
  },

  {
    slug: 'o-replay',
    displayName: 'O-Replay',
    emoji: ''
  },
];

/**
 * Proje slug'ını al
 * @param url - Weblate proje URL'i
 * @returns Proje slug'ı
 * 
 * Örnek: 
 * getSlugFromUrl('https://hosted.weblate.org/projects/metrolist/') 
 * // returns 'metrolist'
 */
export function getSlugFromUrl(url: string): string | null {
  const match = url.match(/projects\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Tüm takip edilen projeleri döndür
 */
export function getWatchedProjects(): WatchedProject[] {
  return watchedProjects;
}

/**
 * Bir proje takip ediliyor mu kontrol et
 * @param slug - Proje slug'ı
 */
export function isProjectWatched(slug: string): boolean {
  return watchedProjects.some(p => p.slug === slug);
}

/**
 * Proje bilgilerini slug ile al
 * @param slug - Proje slug'ı
 */
export function getProjectBySlug(slug: string): WatchedProject | null {
  return watchedProjects.find(p => p.slug === slug) || null;
}
