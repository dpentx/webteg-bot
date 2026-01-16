// api/check-rss.ts - V2 Geliştirilmiş
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const RSS_URL = 'https://hosted.weblate.org/projects/metrolist/changes/rss/';
  
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID');
    return res.status(500).json({ 
      error: 'Missing configuration',
      has_token: !!BOT_TOKEN,
      has_chat_id: !!CHAT_ID
    });
  }

  try {
    console.log('Fetching RSS from:', RSS_URL);
    
    // RSS feed'i çek
    const rssResponse = await fetch(RSS_URL);
    if (!rssResponse.ok) {
      throw new Error(`RSS fetch failed: ${rssResponse.status}`);
    }
    
    const rssText = await rssResponse.text();
    console.log('RSS fetched, length:', rssText.length);
    
    // Daha güvenli XML parsing
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let count = 0;
    
    while ((match = itemRegex.exec(rssText)) !== null && count < 5) {
      const itemXml = match[1];
      
      // Title
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
      const title = titleMatch ? titleMatch[1].trim() : 'Başlık yok';
      
      // Link
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
      const link = linkMatch ? linkMatch[1].trim() : '';
      
      // PubDate
      const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
      const pubDate = dateMatch ? dateMatch[1].trim() : '';
      
      // Description
      const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
      const description = descMatch ? descMatch[1].trim() : '';
      
      items.push({ title, link, pubDate, description });
      count++;
    }
    
    console.log('Parsed items:', items.length);
    
    if (items.length === 0) {
      return res.status(200).json({ 
        success: true,
        changes: 0,
        message: 'RSS feed boş veya parse edilemedi'
      });
    }
    
    // Son 2 saatteki değişiklikleri filtrele (daha geniş aralık)
    const recentItems = items.filter(item => {
      if (!item.pubDate) return false;
      
      const changeTime = new Date(item.pubDate);
      const now = new Date();
      const hoursDiff = (now.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
      
      return hoursDiff <= 2; // 2 saat içindeki değişiklikler
    });
    
    console.log('Recent items (last 2 hours):', recentItems.length);
    
    // Eğer son 2 saatte değişiklik yoksa, en son değişikliği göster (test için)
    const itemsToNotify = recentItems.length > 0 ? recentItems : [items[0]];
    
    // Telegram'a bildirim gönder
    for (const item of itemsToNotify) {
      const isRecent = recentItems.length > 0;
      const emoji = isRecent ? '🔔' : '📋';
      
      const message = `${emoji} <b>Weblate ${isRecent ? 'Güncellemesi' : 'Son Değişiklik'}</b>\n\n` +
        `📦 <b>Proje:</b> Metrolist\n` +
        `⚡ <b>Değişiklik:</b> ${item.title}\n` +
        `🕒 <b>Zaman:</b> ${item.pubDate ? new Date(item.pubDate).toLocaleString('tr-TR') : 'Bilinmiyor'}\n\n` +
        (item.link ? `🔗 <a href="${item.link}">Detayları Gör</a>` : '');

      const telegramResponse = await fetch(
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
      
      const telegramData = await telegramResponse.json();
      console.log('Telegram response:', telegramData);
      
      if (!telegramResponse.ok) {
        console.error('Telegram API error:', telegramData);
        return res.status(500).json({ 
          error: 'Telegram API failed', 
          details: telegramData 
        });
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      changes: itemsToNotify.length,
      recent: recentItems.length,
      total_parsed: items.length,
      message: `${itemsToNotify.length} bildirim gönderildi`
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'RSS check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
