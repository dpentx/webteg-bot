// api/check-rss.ts — RSS tabanlı, Weblate API'si kullanmıyor
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWatchedProjects, type WatchedProject } from '../watch/watch.js';

interface RssItem {
  title: string;       // "Çeviri değiştirildi"
  link: string;        // https://hosted.weblate.org/translate/...
  description: string; // HTML içerikli açıklama
  pubDate: string;     // "Thu, 12 Mar 2026 19:53:45 +0000"
  guid: string;        // tekil tanımlayıcı (link ile aynı genellikle)
}

// --- KV helpers (Upstash REST, paket gerektirmez) ---

async function kvGet(key: string): Promise<number> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) { console.warn('KV env eksik'); return 0; }
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    return data.result ? parseInt(data.result, 10) : 0;
  } catch (e) {
    console.error('KV get failed:', e);
    return 0;
  }
}

async function kvSet(key: string, value: number): Promise<void> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${key}/${value}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error('KV set failed:', e);
  }
}

// --- RSS fetch & parse ---

async function fetchRss(slug: string): Promise<RssItem[] | null> {
  const url = `https://hosted.weblate.org/exports/rss/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'WebtegBot/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    console.log(`RSS fetch status for ${slug}: ${res.status}`);
    if (!res.ok) { console.error(`RSS fetch failed: ${res.status}`); return null; }

    const xml = await res.text();
    return parseRss(xml);
  } catch (e) {
    console.error(`RSS fetch error for ${slug}:`, e);
    return null;
  }
}

function extractTag(xml: string, tag: string): string {
  // CDATA veya düz metin — her ikisini de yakala
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plainMatch ? plainMatch[1].trim() : '';
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title:       extractTag(block, 'title'),
      link:        extractTag(block, 'link'),
      description: extractTag(block, 'description'),
      pubDate:     extractTag(block, 'pubDate'),
      guid:        extractTag(block, 'guid'),
    });
  }
  return items;
}

// --- RSS description'dan bilgi çıkar ---

function parseDescription(desc: string): { user: string; component: string; lang: string } {
  // HTML entity decode
  const decoded = desc
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  // Kullanıcı adı: <span>dpentx</span>
  const userMatch = decoded.match(/<span>([^<]+)<\/span>/);
  const user = userMatch ? userMatch[1] : 'Anonim';

  // Bileşen ve dil: "Metrolist/Metrolist-specific strings — Türkçe dilinde"
  const compLangMatch = decoded.match(/tarafından ([^—]+)—\s*([^\s]+(?:\s[^\s]+)?)\s+dilinde/);
  const component = compLangMatch ? compLangMatch[1].trim() : '';
  const lang      = compLangMatch ? compLangMatch[2].trim() : '';

  return { user, component, lang };
}

// --- Telegram ---

async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return true;
    console.error('Telegram error:', await res.json());
    return false;
  } catch (e) {
    console.error('Telegram request failed:', e);
    return false;
  }
}

function buildMessage(item: RssItem, project: WatchedProject): string {
  const { user, component, lang } = parseDescription(item.description);
  const projectEmoji = project.emoji || '📦';

  // Aksiyon emoji
  const t = item.title.toLowerCase();
  let actionEmoji = '⚡';
  if (t.includes('eklendi') || t.includes('added'))      actionEmoji = '✨';
  if (t.includes('değiştirildi') || t.includes('changed')) actionEmoji = '🔄';
  if (t.includes('tamamlandı') || t.includes('completed')) actionEmoji = '✅';
  if (t.includes('onaylandı') || t.includes('approved'))  actionEmoji = '👍';
  if (t.includes('yorum') || t.includes('comment'))       actionEmoji = '💬';
  if (t.includes('öneri') || t.includes('suggestion'))    actionEmoji = '💡';
  if (t.includes('itildi') || t.includes('pushed'))       actionEmoji = '⬆️';

  const time = new Date(item.pubDate).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  return (
    `🔔 <b>Weblate Güncellemesi</b>\n\n` +
    `${projectEmoji} <b>Proje:</b> ${project.displayName}\n` +
    (component ? `🧩 <b>Bileşen:</b> ${component}\n` : '') +
    (lang      ? `🌐 <b>Dil:</b> ${lang}\n`            : '') +
    `${actionEmoji} <b>Aksiyon:</b> ${item.title}\n` +
    `👤 <b>Kullanıcı:</b> ${user}\n` +
    `🕒 <b>Zaman:</b> ${time}\n\n` +
    `🔗 <a href="${item.link}">Detayları Gör</a>`
  );
}

// --- Ana handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID   = process.env.CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Missing BOT_TOKEN or CHAT_ID' });
  }

  const startTime = Date.now();
  const projects  = getWatchedProjects();

  if (projects.length === 0) {
    return res.status(200).json({ success: true, message: 'Takip edilen proje yok' });
  }

  let totalSent = 0;
  const results: any[] = [];

  for (const project of projects) {
    console.log(`\n=== ${project.displayName} (${project.slug}) ===`);

    try {
      // KV'den son görülen pubDate timestamp'ini al
      const kvKey      = `rss_last_ts_${project.slug}`;
      const lastSeenTs = await kvGet(kvKey);
      console.log(`Last seen timestamp: ${lastSeenTs} (${lastSeenTs ? new Date(lastSeenTs).toISOString() : 'hiç görülmedi'})`);

      const items = await fetchRss(project.slug);
      if (!items) {
        results.push({ project: project.displayName, success: false, error: 'RSS alınamadı' });
        continue;
      }

      if (items.length === 0) {
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'Feed boş' });
        continue;
      }

      // En yüksek pubDate timestamp'ini bul
      const maxTs = Math.max(...items.map(i => new Date(i.pubDate).getTime()));

      // İlk çalışma: spam yapmadan sadece mevcut max timestamp'i kaydet
      if (lastSeenTs === 0) {
        await kvSet(kvKey, maxTs);
        console.log(`İlk çalışma — başlangıç timestamp kaydedildi: ${new Date(maxTs).toISOString()}`);
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'İlk çalışma, başlangıç noktası kaydedildi' });
        continue;
      }

      // Sadece lastSeenTs'den sonraki itemları al, eskiden yeniye sırala
      const newItems = items
        .filter(i => new Date(i.pubDate).getTime() > lastSeenTs)
        .sort((a, b) => new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime());

      console.log(`${newItems.length} yeni item`);

      if (newItems.length === 0) {
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'Yeni değişiklik yok' });
        continue;
      }

      // En fazla 5 bildirim (spam önleme)
      const toSend  = newItems.slice(0, 5);
      let sentCount = 0;

      for (const item of toSend) {
        const msg  = buildMessage(item, project);
        const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, msg);
        if (sent) { sentCount++; totalSent++; }
        if (toSend.length > 1) await new Promise(r => setTimeout(r, 600));
      }

      // KV'yi güncelle
      await kvSet(kvKey, maxTs);
      console.log(`Updated timestamp: ${new Date(maxTs).toISOString()}`);

      const skipped = newItems.length - toSend.length;
      if (skipped > 0) {
        await sendTelegramMessage(BOT_TOKEN, CHAT_ID,
          `ℹ️ <b>${project.displayName}</b>: ${newItems.length} yeni değişiklik, ` +
          `${skipped} tanesi gösterilmedi.\n` +
          `<a href="https://hosted.weblate.org/projects/${project.slug}/">Tümünü gör</a>`
        );
      }

      results.push({ project: project.displayName, success: true, new_items: newItems.length, changes_sent: sentCount });

    } catch (e) {
      console.error(`Error processing ${project.slug}:`, e);
      results.push({ project: project.displayName, success: false, error: e instanceof Error ? e.message : 'Unknown' });
    }

    if (projects.length > 1) await new Promise(r => setTimeout(r, 500));
  }

  return res.status(200).json({
    success: true,
    total_notifications: totalSent,
    projects_checked: projects.length,
    projects: results,
    execution_time_ms: Date.now() - startTime,
  });
}
