// api/check-rss.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWatchedProjects, type WatchedProject } from '../watch/watch.js';

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

// Upstash REST API — @vercel/kv paketi gerektirmez
async function kvGet(key: string): Promise<number> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return 0;
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.result ? parseInt(data.result, 10) : 0;
  } catch {
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
    });
  } catch (e) {
    console.error('KV set failed:', e);
  }
}

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
    if (response.ok) return true;
    const errorData = await response.json();
    console.error('Telegram error:', errorData);
    return false;
  } catch (error) {
    console.error('Telegram request failed:', error);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Missing BOT_TOKEN or CHAT_ID' });
  }

  const startTime = Date.now();

  try {
    const projects: WatchedProject[] = getWatchedProjects();

    if (projects.length === 0) {
      return res.status(200).json({ success: true, message: 'Takip edilen proje yok' });
    }

    let totalSent = 0;
    const results: any[] = [];

    for (const project of projects) {
      console.log(`=== Checking: ${project.displayName} (${project.slug}) ===`);

      try {
        const kvKey = `last_change_id_${project.slug}`;
        const lastSeenId = await kvGet(kvKey);
        console.log(`Last seen ID: ${lastSeenId}`);

        const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}&language=en&page_size=20&ordering=-id`;
        const response = await fetch(API_URL, {
          headers: { Accept: 'application/json', 'User-Agent': 'WebtegBot/1.0' },
        });

        if (!response.ok) {
          results.push({ project: project.displayName, success: false, error: `HTTP ${response.status}` });
          continue;
        }

        const data = await response.json();
        const allChanges: WeblateChange[] = data.results || [];

        const newChanges = allChanges.filter((c) => c.id > lastSeenId).reverse();
        console.log(`${project.displayName}: ${newChanges.length} new changes`);

        if (newChanges.length === 0) {
          results.push({ project: project.displayName, success: true, changes_sent: 0, message: 'Yeni değişiklik yok' });
          continue;
        }

        const changesToSend = newChanges.slice(0, 5);
        let sentCount = 0;

        for (const change of changesToSend) {
          const componentName = change.component?.split('/').filter(Boolean).pop() || 'Bilinmiyor';
          const langMatch =
            change.translation?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\//) ||
            change.url?.match(/\/([a-z]{2}(?:_[A-Z]{2})?)\/$/);
          const langCode = langMatch ? langMatch[1] : 'en';

          let actionEmoji = '⚡';
          const action = (change.action_name || '').toLowerCase();
          if (action.includes('translation')) actionEmoji = '📝';
          if (action.includes('new')) actionEmoji = '✨';
          if (action.includes('comment')) actionEmoji = '💬';
          if (action.includes('suggestion')) actionEmoji = '💡';
          if (action.includes('approved')) actionEmoji = '✅';
          if (action.includes('source')) actionEmoji = '📄';
          if (action.includes('resource') || action.includes('changed')) actionEmoji = '🔄';
          if (action.includes('pushed')) actionEmoji = '⬆️';

          const userName =
            change.user?.split('/').filter(Boolean).pop()?.replace(/:/g, ' ') || 'Anonim';
          const projectEmoji = project.emoji || '📦';

          const message =
            `🔔 <b>Weblate Güncellemesi</b>\n\n` +
            `${projectEmoji} <b>Proje:</b> ${project.displayName}\n` +
            `🧩 <b>Bileşen:</b> ${componentName}\n` +
            `🌐 <b>Dil:</b> ${langCode.toUpperCase()}\n` +
            `${actionEmoji} <b>Aksiyon:</b> ${change.action_name || 'Bilinmiyor'}\n` +
            `👤 <b>Kullanıcı:</b> ${userName}\n` +
            `🕒 <b>Zaman:</b> ${new Date(change.timestamp).toLocaleString('tr-TR')}\n\n` +
            (change.target
              ? `📄 <code>${change.target.substring(0, 100)}${change.target.length > 100 ? '...' : ''}</code>\n\n`
              : '') +
            (change.url ? `🔗 <a href="${change.url}">Detayları Gör</a>` : '');

          const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, message);
          if (sent) { sentCount++; totalSent++; }
          if (changesToSend.length > 1) await new Promise((r) => setTimeout(r, 500));
        }

        const maxId = Math.max(...newChanges.map((c) => c.id));
        await kvSet(kvKey, maxId);
        console.log(`Updated last ID: ${maxId}`);

        const skipped = newChanges.length - changesToSend.length;
        if (skipped > 0) {
          await sendTelegramMessage(
            BOT_TOKEN,
            CHAT_ID,
            `ℹ️ <b>${project.displayName}</b>: ${newChanges.length} yeni değişiklik, ${skipped} tanesi gösterilmedi. ` +
              `<a href="https://hosted.weblate.org/projects/${project.slug}/">Tümünü gör</a>`
          );
        }

        results.push({
          project: project.displayName,
          success: true,
          new_changes: newChanges.length,
          changes_sent: sentCount,
        });
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        results.push({
          project: project.displayName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }

      if (projects.length > 1) await new Promise((r) => setTimeout(r, 500));
    }

    return res.status(200).json({
      success: true,
      total_notifications: totalSent,
      projects_checked: projects.length,
      projects: results,
      execution_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Check failed',
      details: error instanceof Error ? error.message : 'Unknown',
      execution_time_ms: Date.now() - startTime,
    });
  }
}
