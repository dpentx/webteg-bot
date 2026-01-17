// api/check-rss.ts - Timeout ve Bağlantı İyileştirmesi
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
}

interface Project {
  slug: string;
  displayName: string;
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
    { slug: 'metrolist', displayName: 'Metrolist' },
    // Yeni projeler eklemek için:
    // { slug: 'f-droid', displayName: 'F-Droid' },
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
      console.log(`Checking project: ${project.displayName} (${project.slug})`);
      
      // API URL'si - limit ekleyerek daha hızlı yanıt alıyoruz
      const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}&page_size=10`;
      
      try {
        console.log(`Fetching: ${API_URL}`);
        
        // Fetch without custom timeout wrapper - let Vercel handle it
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
        
        // Son 3 saat içindeki değişiklikleri filtrele (daha geniş)
        const now = new Date();
        const recentChanges = data.results.filter((change: WeblateChange) => {
          const changeTime = new Date(change.timestamp);
          const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
          return hoursDiff <= 3; // 3 saat
        }).slice(0, 3); // Max 3 değişiklik
        
        totalRecent += recentChanges.length;
        console.log(`${project.displayName}: ${recentChanges.length} recent changes (last 3 hours)`);
        
        // Test için: Değişiklik yoksa en son 1 değişikliği göster
        const changesToNotify = recentChanges.length > 0 
          ? recentChanges 
          : data.results.slice(0, 1);
        
        console.log(`Will notify ${changesToNotify.length} changes`);
        
        // Telegram'a bildirim gönder
        let sentCount = 0;
        for (const change of changesToNotify) {
          const isRecent = recentChanges.length > 0;
          const emoji = isRecent ? '🔔' : '📋';
          
          let actionEmoji = '⚡';
          const action = (change.action_name || '').toLowerCase();
          if (action.includes('translation')) actionEmoji = '📝';
          if (action.includes('new')) actionEmoji = '✨';
          if (action.includes('comment')) actionEmoji = '💬';
          if (action.includes('suggestion')) actionEmoji = '💡';
          if (action.includes('approved')) actionEmoji = '✅';
          
          const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
            `📦 <b>Proje:</b> ${project.displayName}\n` +
            `🧩 <b>Bileşen:</b> ${change.component || 'Bilinmiyor'}\n` +
            `${actionEmoji} <b>Aksiyon:</b> ${change.action_name || 'Bilinmiyor'}\n` +
            `👤 <b>Kullanıcı:</b> ${change.user || 'Anonim'}\n` +
            `🕒 <b>Zaman:</b> ${new Date(change.timestamp).toLocaleString('tr-TR')}\n\n` +
            (change.target ? `📄 <code>${change.target.substring(0, 100)}${change.target.length > 100 ? '...' : ''}</code>\n\n` : '') +
            (change.url ? `🔗 <a href="${change.url}">Detayları Gör</a>` : '');

          const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, message);
          if (sent) {
            sentCount++;
            totalSent++;
          }
          
          // Rate limiting - mesajlar arası bekleme
          if (changesToNotify.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        results.push({
          project: project.displayName,
          success: true,
          changes: sentCount,
          recent: recentChanges.length,
          total: data.results.length
        });
        
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error details: ${errorMessage}`);
        
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
      projects: results,
      execution_time_ms: executionTime,
      message: `${totalSent} bildirim gönderildi (${projects.length} proje kontrol edildi)`
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
