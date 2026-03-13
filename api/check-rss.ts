// api/check-rss.ts — RSS tabanlı, sadece TR ve EN bildirimleri
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWatchedProjects, type WatchedProject } from '../watch/watch.js';

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
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

// --- Filtre: sadece TR veya EN ilgili itemlar ---
// EN: yeni kaynak string eklenmiş (çevrilmesi gereken yeni içerik)
// TR: Türkçe çeviriye dokunulmuş
function isRelevant(item: RssItem): boolean {
  const link = item.link.toLowerCase();
  const desc = item.description.toLowerCase();

  // Link'te /tr/ veya /en/ geçiyorsa ilgili
  if (link.includes('/tr/') || link.includes('/en/')) return true;

  // Description'da dil adı geçiyorsa (bazı item'larda link dil içermez)
  if (desc.includes('türkçe') || desc.includes('turkish')) return true;
  if (desc.includes('i̇ngilizce') || desc.includes('english')) return true;

  return false;
}

// --- Description parse ---

function parseDescription(desc: string): { user: string; component: string; lang: string } {
  const decoded = desc
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  const userMatch = decoded.match(/<span>([^<]+)<\/span>/);
  const user = userMatch ? userMatch[1] : 'Anonim';

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

  const t = item.title.toLowerCase();
  let actionEmoji = '⚡';
  if (t.includes('eklendi') || t.includes('added'))        actionEmoji = '✨';
  if (t.includes('değiştirildi') || t.includes('changed')) actionEmoji = '🔄';
  if (t.includes('tamamlandı') || t.includes('completed')) actionEmoji = '✅';
  if (t.includes('onaylandı') || t.includes('approved'))   actionEmoji = '👍';
  if (t.includes('yorum') || t.includes('comment'))        actionEmoji = '💬';
  if (t.includes('öneri') || t.includes('suggestion'))     actionEmoji = '💡';
  if (t.includes('itildi') || t.includes('pushed'))        actionEmoji = '⬆️';

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
      const kvKey      = `rss_last_ts_${project.slug}`;
      const lastSeenTs = await kvGet(kvKey);
      console.log(`Last seen timestamp: ${lastSeenTs}`);

      const items = await fetchRss(project.slug);
      if (!items) {
        results.push({ project: project.displayName, success: false, error: 'RSS alınamadı' });
        continue;
      }

      if (items.length === 0) {
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'Feed boş' });
        continue;
      }

      const maxTs = Math.max(...items.map(i => new Date(i.pubDate).getTime()));

      // İlk çalışma
      if (lastSeenTs === 0) {
        await kvSet(kvKey, maxTs);
        console.log(`İlk çalışma — başlangıç timestamp kaydedildi`);
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'İlk çalışma, başlangıç noktası kaydedildi' });
        continue;
      }

      // Yeni itemlar — önce zaman filtresi, sonra dil filtresi
      const newItems = items
        .filter(i => new Date(i.pubDate).getTime() > lastSeenTs)
        .sort((a, b) => new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime());

      const relevantItems = newItems.filter(isRelevant);

      console.log(`${newItems.length} yeni item, ${relevantItems.length} tanesi TR/EN ilgili`);

      // Timestamp'i her zaman güncelle (alakasız dilleri de geç)
      if (newItems.length > 0) {
        await kvSet(kvKey, maxTs);
      }

      if (relevantItems.length === 0) {
        results.push({ project: project.displayName, success: true, changes_sent: 0, message: `${newItems.length} yeni item var ama TR/EN değil, atlandı` });
        continue;
      }

      const toSend  = relevantItems.slice(0, 5);
      let sentCount = 0;

      for (const item of toSend) {
        const msg  = buildMessage(item, project);
        const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, msg);
        if (sent) { sentCount++; totalSent++; }
        if (toSend.length > 1) await new Promise(r => setTimeout(r, 600));
      }

      const skipped = relevantItems.length - toSend.length;
      if (skipped > 0) {
        await sendTelegramMessage(BOT_TOKEN, CHAT_ID,
          `ℹ️ <b>${project.displayName}</b>: ${relevantItems.length} yeni TR/EN değişiklik, ` +
          `${skipped} tanesi gösterilmedi.\n` +
          `<a href="https://hosted.weblate.org/projects/${project.slug}/">Tümünü gör</a>`
        );
      }

      results.push({
        project: project.displayName,
        success: true,
        new_items: newItems.length,
        relevant_items: relevantItems.length,
        changes_sent: sentCount,
      });

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
