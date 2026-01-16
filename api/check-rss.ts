// api/check-rss.ts - Çoklu Proje Desteği
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
  slug: string;      // Weblate'teki proje slug'ı (URL'deki isim)
  displayName: string; // Telegram mesajında görünecek isim
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  
  // 🎯 Takip edilecek projeler - Buraya ekle/çıkar
  const projects: Project[] = [
    { slug: 'metrolist', displayName: 'Metrolist' },
    // Yeni projeler eklemek için:
    // { slug: 'proje-slug', displayName: 'Görünecek İsim' },
    // { slug: 'another-project', displayName: 'Başka Proje' },
  ];
  
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID');
    return res.status(500).json({ 
      error: 'Missing configuration',
      has_token: !!BOT_TOKEN,
      has_chat_id: !!CHAT_ID
    });
  }

  try {
    let totalSent = 0;
    let totalRecent = 0;
    const results: any[] = [];
    
    // Her proje için kontrol et
    for (const project of projects) {
      console.log(`Checking project: ${project.displayName} (${project.slug})`);
      
      const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}`;
      
      try {
        const response = await fetch(API_URL, {
          headers: { 'Accept': 'application/json' }
        });
        
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
        }).slice(0, 5);
        
        totalRecent += recentChanges.length;
        console.log(`${project.displayName}: ${recentChanges.length} recent changes`);
        
        // Test için: Son 2 saatte değişiklik yoksa en son 1 değişikliği göster
        const changesToNotify = recentChanges.length > 0 
          ? recentChanges 
          : data.results.slice(0, 1);
        
        // Telegram'a bildirim gönder
        let sentCount = 0;
        for (const change of changesToNotify) {
          const isRecent = recentChanges.length > 0;
          const emoji = isRecent ? '🔔' : '📋';
          
          // Action'a göre emoji
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

          const telegramResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
              }),
            }
          );
          
          if (telegramResponse.ok) {
            sentCount++;
            totalSent++;
          } else {
            const errorData = await telegramResponse.json();
            console.error('Telegram error:', errorData);
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
      
      // Projeler arası bekleme
      if (projects.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return res.status(200).json({ 
      success: true,
      total_notifications: totalSent,
      total_recent_changes: totalRecent,
      projects: results,
      message: `${totalSent} bildirim gönderildi (${projects.length} proje kontrol edildi)`
    });

  } catch (error) {
    console.error('Global error:', error);
    return res.status(500).json({ 
      error: 'Check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
        }
