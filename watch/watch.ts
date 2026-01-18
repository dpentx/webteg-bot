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
  
  // Yeni projeler eklemek için:
  // {
  //   slug: 'f-droid',
  //   displayName: 'F-Droid',
  //   emoji: '📱'
  // },
  // {
  //   slug: 'element',
  //   displayName: 'Element',
  //   emoji: '💬'
  // },
  // {
  //   slug: 'osmand',
  //   displayName: 'OsmAnd',
  //   emoji: '🗺️'
  // },
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
