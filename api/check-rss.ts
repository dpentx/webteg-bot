// api/check-rss.ts - Weblate API Key ile Kişisel Takip
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

interface Subscription {
  scope: number;
  frequency: string;
  project: {
    name: string;
    slug: string;
  };
  component?: {
    name: string;
    slug: string;
  };
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

// 🔍 Kullanıcının takip ettiği projeleri al
async function getUserSubscriptions(apiKey: string): Promise<Subscription[]> {
  try {
    const url = 'https://hosted.weblate.org/api/user/subscriptions/';
    console.log('Fetching user subscriptions...');
    
    const response = await fetch(url, {
      headers: { 
        'Accept': 'application/json',
        'Authorization': `Token ${apiKey}`,
        'User-Agent': 'WebtegBot/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch subscriptions: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const subscriptions = data.results || [];
    console.log(`Found ${subscriptions.length} subscriptions`);
    
    // Sadece proje bazlı takipleri al (component bazlı olanları filtrele)
    const projectSubs = subscriptions.filter((sub: Subscription) => 
      sub.project && !sub.component
    );
    
    console.log('Subscribed projects:', 
      projectSubs.map((s: Subscription) => s.project.slug).join(', ')
    );
    
    return projectSubs;
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return [];
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const WEBLATE_API_KEY = process.env.WEBLATE_API_KEY;
  
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID');
    return res.status(500).json({ 
      error: 'Missing configuration',
      has_token: !!BOT_TOKEN,
      has_chat_id: !!CHAT_ID
    });
  }

  if (!WEBLATE_API_KEY) {
    console.error('Missing WEBLATE_API_KEY');
    return res.status(500).json({ 
      error: 'Missing WEBLATE_API_KEY',
      message: 'Lütfen Vercel environment variables\'a WEBLATE_API_KEY ekleyin'
    });
  }

  const startTime = Date.now();

  try {
    // Kullanıcının takip ettiği projeleri al
    const subscriptions = await getUserSubscriptions(WEBLATE_API_KEY);
    
    if (subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Takip edilen proje bulunamadı. Weblate\'te proje takip etmeyi deneyin.',
        total_notifications: 0,
        projects: []
      });
    }
    
    let totalSent = 0;
    let totalRecent = 0;
    const results: any[] = [];
    
    // Her takip edilen proje için
    for (const subscription of subscriptions) {
      const projectSlug = subscription.project.slug;
      const projectName = subscription.project.name;
      
      console.log(`\n=== Checking subscribed project: ${projectName} (${projectSlug}) ===`);
      
      try {
        // Proje değişikliklerini çek (sadece İngilizce)
        const API_URL = `https://hosted.weblate.org/api/changes/?project=${projectSlug}&language=en&page_size=10`;
        console.log(`Fetching: ${API_URL}`);
        
        const response = await fetch(API_URL, {
          headers: { 
            'Accept': 'application/json',
            'Authorization': `Token ${WEBLATE_API_KEY}`,
            'User-Agent': 'WebtegBot/1.0'
          }
        });
        
        if (!response.ok) {
          console.error(`API fetch failed for ${projectSlug}: ${response.status}`);
          results.push({
            project: projectName,
            success: false,
            error: `HTTP ${response.status}`
          });
          continue;
        }
        
        const data = await response.json();
        const changes = data.results || [];
        console.log(`${projectName}: ${changes.length} English changes found`);
        
        if (changes.length === 0) {
          results.push({
            project: projectName,
            success: true,
            changes: 0,
            message: 'Değişiklik yok'
          });
          continue;
        }
        
        // Son 3 saat içindeki değişiklikleri filtrele
        const now = new Date();
        const recentChanges = changes.filter((change: WeblateChange) => {
          const changeTime = new Date(change.timestamp);
          const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
          return hoursDiff <= 3;
        }).slice(0, 5);
        
        totalRecent += recentChanges.length;
        console.log(`${projectName}: ${recentChanges.length} recent changes (last 3 hours)`);
        
        // Test için: Değişiklik yoksa en son 1 değişikliği göster
        const changesToNotify = recentChanges.length > 0 
          ? recentChanges 
          : changes.slice(0, 1);
        
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
          const langFlag = '🇬🇧'; // Sadece İngilizce
          
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
          const userName = change.user?.split('/').filter(Boolean).pop()?.replace(/:/g, ' ') || 'Anonim';
          
          const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
            `📦 <b>Proje:</b> ${projectName}\n` +
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
          project: projectName,
          success: true,
          changes: sentCount,
          recent: recentChanges.length,
          total: changes.length
        });
        
      } catch (error) {
        console.error(`Error processing ${projectSlug}:`, error);
        results.push({
          project: projectName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Projeler arası bekleme
      if (subscriptions.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`\n=== Execution completed in ${executionTime}ms ===`);
    
    return res.status(200).json({ 
      success: true,
      total_notifications: totalSent,
      total_recent_changes: totalRecent,
      subscribed_projects: subscriptions.length,
      projects: results,
      execution_time_ms: executionTime,
      message: `${totalSent} bildirim gönderildi (${subscriptions.length} takip edilen proje)`
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
