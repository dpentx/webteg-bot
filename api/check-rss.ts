// api/check-rss.ts - Modüler Versiyon
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Watch listesini import et
const { getWatchedProjects } = require('../watch/watch.js');

interface WeblateChange {
  id: number;
  action_name: string;
  target: string;
  timestamp: string;
  translation: string;
  user: string;
  component: string;
  url: string;
}

interface WatchedProject {
  slug: string;
  displayName: string;
  emoji?: string;
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
    // Watch listesinden projeleri al
    const projects: WatchedProject[] = getWatchedProjects();
    
    if (projects.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'watch/watch.js dosyasında takip edilen proje yok',
        total_notifications: 0,
        projects: []
      });
    }
    
    console.log(`Checking ${projects.length} watched projects:`, 
      projects.map(p => p.slug).join(', ')
    );
    
    let totalSent = 0;
    let totalRecent = 0;
    const results: any[] = [];
    
    for (const project of projects) {
      console.log(`\n=== Checking project: ${project.displayName} (${project.slug}) ===`);
      
      try {
        // Proje değişikliklerini çek (sadece İngilizce)
        const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}&language=en&page_size=10`;
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
        const changes = data.results || [];
        console.log(`${project.displayName}: ${changes.length} English changes found`);
        
        if (changes.length === 0) {
          results.push({
            project: project.displayName,
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
        console.log(`${project.displayName}: ${recentChanges.length} recent changes (last 3 hours)`);
        
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
          const langFlag = '🇬🇧';
          
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
          
          // Proje emoji'si varsa kullan
          const projectEmoji = project.emoji || '📦';
          
          const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
            `${projectEmoji} <b>Proje:</b> ${project.displayName}\n` +
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
          total: changes.length
        });
        
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        results.push({
          project: project.displayName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Projeler arası bekleme
      if (projects.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`\n=== Execution completed in ${executionTime}ms ===`);
    
    return res.status(200).json({ 
      success: true,
      total_notifications: totalSent,
      total_recent_changes: totalRecent,
      projects_checked: projects.length,
      projects: results,
      execution_time_ms: executionTime,
      message: `${totalSent} bildirim gönderildi (${projects.length} proje, sadece İngilizce)`
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
