// watch/watch.js
// Takip edilecek Weblate projelerinin listesi

/**
 * @typedef {Object} WatchedProject
 * @property {string} slug - Weblate'teki proje slug'ı (URL'den)
 * @property {string} displayName - Telegram mesajlarında görünecek isim
 * @property {string} [emoji] - Proje için özel emoji (opsiyonel)
 */

/**
 * Takip edilen projeler
 * @type {WatchedProject[]}
 */
const watchedProjects = [
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
 * @param {string} url - Weblate proje URL'i
 * @returns {string} Proje slug'ı
 * 
 * Örnek: 
 * getSlugFromUrl('https://hosted.weblate.org/projects/metrolist/') 
 * // returns 'metrolist'
 */
function getSlugFromUrl(url) {
  const match = url.match(/projects\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Tüm takip edilen projeleri döndür
 * @returns {WatchedProject[]}
 */
function getWatchedProjects() {
  return watchedProjects;
}

/**
 * Bir proje takip ediliyor mu kontrol et
 * @param {string} slug - Proje slug'ı
 * @returns {boolean}
 */
function isProjectWatched(slug) {
  return watchedProjects.some(p => p.slug === slug);
}

/**
 * Proje bilgilerini slug ile al
 * @param {string} slug - Proje slug'ı
 * @returns {WatchedProject|null}
 */
function getProjectBySlug(slug) {
  return watchedProjects.find(p => p.slug === slug) || null;
}

module.exports = {
  watchedProjects,
  getSlugFromUrl,
  getWatchedProjects,
  isProjectWatched,
  getProjectBySlug
};
