// api/check-rss.ts - Çoklu Proje Desteği (İyileştirilmiş)
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

// ⏱️ Timeout wrapper
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 8000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// 📨 Telegram mesajı gönder (retry mekanizmalı)
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string,
  retries = 2
): Promise<boolean> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetchWithTimeout(
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
        },
        5000 // 5 saniye timeout
      );
      
      if (response.ok) return true;
      
      const errorData = await response.json();
      console.error(`Telegram error (attempt ${i + 1}):`, errorData);
      
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    } catch (error) {
      console.error(`Telegram request failed (attempt ${i + 1}):`, error);
      if (i === retries) return false;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return false;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  
  const projects: Project[] = [
    { slug: 'metrolist', displayName: 'Metrolist' },
  ];
  
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID');
    return res.status(500).json({ 
      error: 'Missing configuration',
      has_token: !!BOT_TOKEN,
      has_chat_id: !!CHAT_ID
    });
  }

  // ⏰ Başlangıç zamanı - toplam süreyi kontrol et
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 9000; // 9 saniye (Vercel limit 10sn)

  try {
    let totalSent = 0;
    let totalRecent = 0;
    const results: any[] = [];
    
    for (const project of projects) {
      // Zaman kontrolü
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.warn('Execution time limit approaching, stopping early');
        results.push({
          project: project.displayName,
          success: false,
          error: 'Timeout - zaman aşımı'
        });
        break;
      }
      
      console.log(`Checking project: ${project.displayName} (${project.slug})`);
      
      const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}`;
      
      try {
        // ⏱️ Timeout ile fetch
        const response = await fetchWithTimeout(API_URL, {
          headers: { 'Accept': 'application/json' }
        }, 5000);
        
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
        console.log(`${project.displayName}: ${data.results?.length || 0} total changes`);
        
        if (!data.results || data.results.length === 0) {
          results.push({
            project: project.displayName,
            success: true,
            changes: 0,
            message: 'Değişiklik yok'
          });
          continue;
        }
        
        // Son 2 saat içindeki değişiklikleri filtrele
        const now = new Date();
        const recentChanges = data.results.filter((change: WeblateChange) => {
          const changeTime = new Date(change.timestamp);
          const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
          return hoursDiff <= 2;
        }).slice(0, 5); // Maksimum 5 değişiklik
        
        totalRecent += recentChanges.length;
        console.log(`${project.displayName}: ${recentChanges.length} recent changes`);
        
        // Test için: Son 2 saatte değişiklik yoksa en son 1 değişikliği göster
        const changesToNotify = recentChanges.length > 0 
          ? recentChanges 
          : data.results.slice(0, 1);
        
        // 🚀 Telegram'a bildirim gönder (paralel)
        let sentCount = 0;
        const sendPromises = changesToNotify.map(async (change, index) => {
          // Zaman kontrolü
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            return false;
          }
          
          // Rate limiting için gecikme
          await new Promise(resolve => setTimeout(resolve, index * 300));
          
          const isRecent = recentChanges.length > 0;
          const emoji = isRecent ? '🔔' : '📋';
          
          let actionEmoji = '⚡';
          const action = change.action_name.toLowerCase();
          if (action.includes('translation')) actionEmoji = '📝';
          if (action.includes('new')) actionEmoji = '✨';
          if (action.includes('comment')) actionEmoji = '💬';
          if (action.includes('suggestion')) actionEmoji = '💡';
          if (action.includes('approved')) actionEmoji = '✅';
          
          const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
            `📦 <b>Proje:</b> ${project.displayName}\n` +
            `🧩 <b>Bileşen:</b> ${change.component || 'Bilinmiyor'}\n` +
            `${actionEmoji} <b>Aksiyon:</b> ${change.action_name}\n` +
            `👤 <b>Kullanıcı:</b> ${change.user || 'Anonim'}\n` +
            `🕒 <b>Zaman:</b> ${new Date(change.timestamp).toLocaleString('tr-TR')}\n\n` +
            (change.target ? `📄 <code>${change.target.substring(0, 100)}${change.target.length > 100 ? '...' : ''}</code>\n\n` : '') +
            (change.url ? `🔗 <a href="${change.url}">Detayları Gör</a>` : '');

          return await sendTelegramMessage(BOT_TOKEN!, CHAT_ID!, message);
        });
        
        // Tüm mesajları paralel gönder
        const sendResults = await Promise.allSettled(sendPromises);
        sentCount = sendResults.filter(r => r.status === 'fulfilled' && r.value).length;
        totalSent += sentCount;
        
        results.push({
          project: project.displayName,
          success: true,
          changes: sentCount,
          recent: recentChanges.length,
          total: data.results.length
        });
        
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        results.push({
          project: project.displayName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Projeler arası bekleme (zaman varsa)
      if (projects.length > 1 && Date.now() - startTime < MAX_EXECUTION_TIME - 1000) {
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
