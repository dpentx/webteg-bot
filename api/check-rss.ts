// api/check-rss.ts - Direkt Component API Kullanarak
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
  components: string[]; // Takip edilecek component slug'ları
  languageFilter?: string[];
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

// 🔍 Component'leri listele
async function getProjectComponents(projectSlug: string): Promise<string[]> {
  try {
    const url = `https://hosted.weblate.org/api/projects/${projectSlug}/components/`;
    console.log(`Fetching components for ${projectSlug}`);
    
    const response = await fetch(url, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'WebtegBot/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch components: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const components = data.results?.map((c: any) => c.slug) || [];
    console.log(`Found ${components.length} components:`, components);
    return components;
  } catch (error) {
    console.error('Error fetching components:', error);
    return [];
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
      components: [], // Boş = tüm component'leri al
      languageFilter: ['en']
    },
    // Manuel component listesi vererek:
    // { 
    //   slug: 'metrolist', 
    //   displayName: 'Metrolist',
    //   components: ['app', 'website', 'morse-app'], // Sadece bunlar
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
    const results: any[] = [];
    
    for (const project of projects) {
      console.log(`\n=== Checking project: ${project.displayName} (${project.slug}) ===`);
      
      // Component listesini al
      let componentSlugs = project.components;
      if (componentSlugs.length === 0) {
        componentSlugs = await getProjectComponents(project.slug);
        if (componentSlugs.length === 0) {
          console.error(`No components found for ${project.slug}`);
          results.push({
            project: project.displayName,
            success: false,
            error: 'No components found'
          });
          continue;
        }
      }
      
      const allChanges: WeblateChange[] = [];
      
      // Her component için ayrı ayrı değişiklikleri çek
      for (const componentSlug of componentSlugs) {
        try {
          const API_URL = `https://hosted.weblate.org/api/components/${project.slug}/${componentSlug}/changes/?page_size=5`;
          console.log(`Fetching: ${API_URL}`);
          
          const response = await fetch(API_URL, {
            headers: { 
              'Accept': 'application/json',
              'User-Agent': 'WebtegBot/1.0'
            }
          });
          
          if (!response.ok) {
            console.warn(`Component ${componentSlug} fetch failed: ${response.status}`);
            continue; // Bu component'i atla, diğerlerine devam et
          }
          
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            console.log(`${componentSlug}: ${data.results.length} changes`);
            allChanges.push(...data.results);
          }
          
        } catch (error) {
          console.error(`Error fetching component ${componentSlug}:`, error);
          continue;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.log(`Total changes collected: ${allChanges.length}`);
      
      if (allChanges.length === 0) {
        results.push({
          project: project.displayName,
          success: true,
          changes: 0,
          message: 'Değişiklik yok'
        });
        continue;
      }
      
      // Dil filtresi uygula
      let filteredChanges = allChanges;
      if (project.languageFilter && project.languageFilter.length > 0) {
        filteredChanges = allChanges.filter((change: WeblateChange) => {
          const langMatch = change.translation?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\//) || 
                           change.url?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\/$/);
          const changeLang = langMatch ? langMatch[1] : null;
          
          if (!changeLang) {
            console.log('No language detected, including by default');
            return true;
          }
          
          const isMatch = project.languageFilter!.includes(changeLang);
          if (!isMatch) {
            console.log(`Filtering out ${changeLang} change`);
          }
          return isMatch;
        });
        console.log(`After language filter: ${filteredChanges.length} changes`);
      }
      
      // Timestamp'e göre sırala (en yeni önce)
      filteredChanges.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // Duplicate'leri temizle (aynı ID)
      const uniqueChanges = Array.from(
        new Map(filteredChanges.map(c => [c.id, c])).values()
      );
      console.log(`After deduplication: ${uniqueChanges.length} unique changes`);
      
      // Son 3 saat içindeki değişiklikler
      const now = new Date();
      const recentChanges = uniqueChanges.filter((change: WeblateChange) => {
        const changeTime = new Date(change.timestamp);
        const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
        return hoursDiff <= 3;
      }).slice(0, 5);
      
      totalRecent += recentChanges.length;
      console.log(`Recent changes (last 3 hours): ${recentChanges.length}`);
      
      // Test için: Değişiklik yoksa en son 1 değişikliği göster
      const changesToNotify = recentChanges.length > 0 
        ? recentChanges 
        : uniqueChanges.slice(0, 1);
      
      console.log(`Will notify ${changesToNotify.length} changes`);
      
      // Telegram'a bildirim gönder
      let sentCount = 0;
      for (const change of changesToNotify) {
        const isRecent = recentChanges.length > 0;
        const emoji = isRecent ? '🔔' : '📋';
        
        // Component ismini temizle
        const componentName = change.component?.split('/').filter(Boolean).pop() || 'Bilinmiyor';
        
        // Dil bilgisi
        const langMatch = change.translation?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\//) || 
                         change.url?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\/$/);
        const langCode = langMatch ? langMatch[1] : 'en';
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
        if (action.includes('pushed')) actionEmoji = '⬆️';
        if (action.includes('changed')) actionEmoji = '🔄';
        
        // Kullanıcı adını temizle
        const userName = change.user?.split('/').filter(Boolean).pop()?.replace(':', ' ') || 'Anonim';
        
        const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
          `📦 <b>Proje:</b> ${project.displayName}\n` +
          `🧩 <b>Bileşen:</b> ${componentName}\n` +
          `${langFlag} <b>Dil:</b> ${langCode.toUpperCase()}\n` +
          `${actionEmoji} <b>Aksiyon:</b> ${change.action_name || 'Bilinmiyor'}\n` +
          `👤 <b>Kullanıcı:</b> ${userName}\n` +
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
        total: uniqueChanges.length,
        components_checked: componentSlugs.length,
        filtered_languages: project.languageFilter?.join(', ') || 'all'
      });
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`\n=== Execution completed in ${executionTime}ms ===`);
    
    return res.status(200).json({ 
      success: true,
      total_notifications: totalSent,
      total_recent_changes: totalRecent,
      projects: results,
      execution_time_ms: executionTime,
      message: `${totalSent} bildirim gönderildi (${projects.length} proje)`
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
