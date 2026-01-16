// api/check-rss.ts
// Weblate RSS feed'ini kontrol edip Telegram'a bildirim gönderir
import type { VercelRequest, VercelResponse } from '@vercel/node';

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const RSS_URL = 'https://hosted.weblate.org/projects/metrolist/changes/rss/';
  
  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Missing configuration' });
  }

  try {
    // RSS feed'i çek
    const rssResponse = await fetch(RSS_URL);
    const rssText = await rssResponse.text();
    
    // Basit XML parsing (son 5 değişiklik)
    const itemMatches = rssText.matchAll(/<item>(.*?)<\/item>/gs);
    const recentChanges: RSSItem[] = [];
    
    let count = 0;
    for (const match of itemMatches) {
      if (count >= 5) break; // Son 5 değişikliği al
      
      const itemXml = match[1];
      const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || '';
      const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      const description = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] || '';
      
      // Son 1 saat içindeki değişiklikleri kontrol et
      const changeTime = new Date(pubDate);
      const now = new Date();
      const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff <= 1) {
        recentChanges.push({ title, link, pubDate, description });
      }
      count++;
    }

    // Yeni değişiklik varsa bildir
    if (recentChanges.length > 0) {
      for (const change of recentChanges) {
        const message = `🔔 <b>Weblate Güncellemesi</b>\n\n` +
          `📦 <b>Proje:</b> Metrolist\n` +
          `⚡ <b>Değişiklik:</b> ${change.title}\n` +
          `🕒 <b>Zaman:</b> ${new Date(change.pubDate).toLocaleString('tr-TR')}\n\n` +
          `🔗 <a href="${change.link}">Detayları Gör</a>`;

        await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: CHAT_ID,
              text: message,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
            }),
          }
        );
      }
      
      return res.status(200).json({ 
        success: true, 
        changes: recentChanges.length,
        message: `${recentChanges.length} yeni değişiklik bildirildi` 
      });
    }

    return res.status(200).json({ 
      success: true, 
      changes: 0,
      message: 'Yeni değişiklik yok' 
    });

  } catch (error) {
    console.error('RSS check error:', error);
    return res.status(500).json({ 
      error: 'RSS check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
      }
