// api/check-rss.ts - Bileşen ve Dil Filtreli
import type { VercelRequest, VercelResponse } from '@vercel/node';

interface WeblateChange {
  id: number;
  action_name: string;
  target: string;
  timestamp: string;
  translation: string;
  user: string;
  component: string;
  url: string;
  language?: string;
}

interface Project {
  slug: string;
  displayName: string;
  languageFilter?: string[];
  componentFilter?: string[]; // Sadece bu bileşenleri takip et (opsiyonel)
}

// 📨 Telegram mesajı gönder
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    
    if (response.ok) {
      console.log('Telegram message sent successfully');
      return true;
    }
    
    const errorData = await response.json();
    console.error('Telegram error:', errorData);
    return false;
  } catch (error) {
    console.error('Telegram request failed:', error);
    return false;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  
  // 🎯 Takip edilecek projeler
  const projects: Project[] = [
    { 
      slug: 'metrolist', 
      displayName: 'Metrolist',
      languageFilter: ['en'], // Sadece İngilizce
      // componentFilter kullanmak istersen:
      // componentFilter: ['morse-app', 'website', 'hosted'] // Sadece bunlar
    },
    // Yeni projeler:
    // { 
    //   slug: 'f-droid', 
    //   displayName: 'F-Droid',
    //   languageFilter: ['en']
    // },
  ];
  
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID');
    return res.status(500).json({ 
      error: 'Missing configuration',
      has_token: !!BOT_TOKEN,
      has_chat_id: !!CHAT_ID
    });
  }

  const startTime = Date.now();

  try {
    let totalSent = 0;
    let totalRecent = 0;
    let totalFilteredLang = 0;
    let totalFilteredComp = 0;
    const results: any[] = [];
    
    for (const project of projects) {
      console.log(`Checking project: ${project.displayName} (${project.slug})`);
      
      // API URL'si
      let API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}&page_size=20`;
      
      // Dil filtresi varsa ekle
      if (project.languageFilter && project.languageFilter.length > 0) {
        const langParam = project.languageFilter.join(',');
        API_URL += `&language=${langParam}`;
        console.log(`Filtering languages: ${langParam}`);
      }
      
      try {
        console.log(`Fetching: ${API_URL}`);
        
        const response = await fetch(API_URL, {
          headers: { 
            'Accept': 'application/json',
            'User-Agent': 'WebtegBot/1.0'
          }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (!response.ok) {
          console.error(`API fetch failed for ${project.slug}: ${response.status}`);
          results.push({
            project: project.displayName,
            success: false,
            error: `HTTP ${response.status}`
          });
          continue;
        }
        
        const data = await response.json();
        console.log(`${project.displayName}: ${data.results?.length || 0} total changes found`);
        
        if (!data.results || data.results.length === 0) {
          results.push({
            project: project.displayName,
            success: true,
            changes: 0,
            message: 'Değişiklik yok'
          });
          continue;
        }
        
        // 🔍 BİLEŞEN FİLTRESİ - Sadece projeye ait bileşenleri al
        let filteredChanges = data.results.filter((change: WeblateChange) => {
          // Component URL'den proje slug'ını çıkar
          const componentUrl = change.component || '';
          const projectMatch = componentUrl.match(/\/projects\/([^/]+)\//);
          const changeProjectSlug = projectMatch ? projectMatch[1] : null;
          
          // Değişiklik başka bir projeyse filtrele
          if (changeProjectSlug && changeProjectSlug !== project.slug) {
            console.log(`Filtering out: ${componentUrl} (belongs to ${changeProjectSlug})`);
            totalFilteredComp++;
            return false;
          }
          
          // Eğer componentFilter varsa, sadece belirtilen bileşenleri al
          if (project.componentFilter && project.componentFilter.length > 0) {
            const componentName = componentUrl.split('/').pop() || '';
            const isAllowed = project.componentFilter.some(allowed => 
              componentName.includes(allowed)
            );
            if (!isAllowed) {
              console.log(`Filtering out component: ${componentName}`);
              totalFilteredComp++;
              return false;
            }
          }
          
          return true;
        });
        
        console.log(`After component filter: ${filteredChanges.length} changes`);
        
        // Dil filtresi (double-check)
        if (project.languageFilter && project.languageFilter.length > 0) {
          const beforeLangFilter = filteredChanges.length;
          filteredChanges = filteredChanges.filter((change: WeblateChange) => {
            const langMatch = change.translation?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\//) || 
                             change.url?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\/$/);
            const changeLang = langMatch ? langMatch[1] : null;
            
            if (!changeLang) return true;
            
            return project.languageFilter!.includes(changeLang);
          });
          const filtered = beforeLangFilter - filteredChanges.length;
          totalFilteredLang += filtered;
          if (filtered > 0) {
            console.log(`Filtered ${filtered} non-matching language changes`);
          }
        }
        
        // Son 3 saat içindeki değişiklikleri filtrele
        const now = new Date();
        const recentChanges = filteredChanges.filter((change: WeblateChange) => {
          const changeTime = new Date(change.timestamp);
          const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
          return hoursDiff <= 3;
        }).slice(0, 5);
        
        totalRecent += recentChanges.length;
        console.log(`${project.displayName}: ${recentChanges.length} recent changes (last 3 hours)`);
        
        // Test için: Değişiklik yoksa en son 1 değişikliği göster
        const changesToNotify = recentChanges.length > 0 
          ? recentChanges 
          : filteredChanges.slice(0, 1);
        
        console.log(`Will notify ${changesToNotify.length} changes`);
        
        // Telegram'a bildirim gönder
        let sentCount = 0;
        for (const change of changesToNotify) {
          const isRecent = recentChanges.length > 0;
          const emoji = isRecent ? '🔔' : '📋';
          
          // Component ismini temizle (sadece son kısım)
          const componentName = change.component?.split('/').pop() || 'Bilinmiyor';
          
          // Dil bilgisi
          const langMatch = change.translation?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\//) || 
                           change.url?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\/$/);
          const langCode = langMatch ? langMatch[1] : 'unknown';
          const langFlag = langCode === 'en' ? '🇬🇧' : langCode === 'tr' ? '🇹🇷' : '🌐';
          
          let actionEmoji = '⚡';
          const action = (change.action_name || '').toLowerCase();
          if (action.includes('translation')) actionEmoji = '📝';
          if (action.includes('new')) actionEmoji = '✨';
          if (action.includes('comment')) actionEmoji = '💬';
          if (action.includes('suggestion')) actionEmoji = '💡';
          if (action.includes('approved')) actionEmoji = '✅';
          if (action.includes('source')) actionEmoji = '📄';
          if (action.includes('resource')) actionEmoji = '🔄';
          
          const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
            `📦 <b>Proje:</b> ${project.displayName}\n` +
            `🧩 <b>Bileşen:</b> ${componentName}\n` +
            `${langFlag} <b>Dil:</b> ${langCode.toUpperCase()}\n` +
            `${actionEmoji} <b>Aksiyon:</b> ${change.action_name || 'Bilinmiyor'}\n` +
            `👤 <b>Kullanıcı:</b> ${change.user?.split('/').pop() || 'Anonim'}\n` +
            `🕒 <b>Zaman:</b> ${new Date(change.timestamp).toLocaleString('tr-TR')}\n\n` +
            (change.target ? `📄 <code>${change.target.substring(0, 100)}${change.target.length > 100 ? '...' : ''}</code>\n\n` : '') +
            (change.url ? `🔗 <a href="${change.url}">Detayları Gör</a>` : '');

          const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, message);
          if (sent) {
            sentCount++;
            totalSent++;
          }
          
          // Rate limiting
          if (changesToNotify.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        results.push({
          project: project.displayName,
          success: true,
          changes: sentCount,
          recent: recentChanges.length,
          total: data.results.length,
          filtered_languages: project.languageFilter?.join(', ') || 'all',
          filtered_components: totalFilteredComp
        });
        
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        results.push({
          project: project.displayName,
          success: false,
          error: errorMessage
        });
      }
      
      // Projeler arası bekleme
      if (projects.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`Execution completed in ${executionTime}ms`);
    
    return res.status(200).json({ 
      success: true,
      total_notifications: totalSent,
      total_recent_changes: totalRecent,
      total_filtered_components: totalFilteredComp,
      total_filtered_languages: totalFilteredLang,
      projects: results,
      execution_time_ms: executionTime,
      message: `${totalSent} bildirim gönderildi (${projects.length} proje, sadece İngilizce, sadece proje bileşenleri)`
    });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Global error:', error);
    return res.status(500).json({ 
      error: 'Check failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      execution_time_ms: executionTime
    });
  }
      }
