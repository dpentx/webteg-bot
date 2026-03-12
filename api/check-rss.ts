// api/check-rss.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { getWatchedProjects, type WatchedProject } from '../watch/watch';

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
      has_chat_id: !!CHAT_ID,
    });
  }

  const startTime = Date.now();

  try {
    const projects: WatchedProject[] = getWatchedProjects();

    if (projects.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'watch/watch.ts dosyasında takip edilen proje yok',
        total_notifications: 0,
        projects: [],
      });
    }

    console.log(
      `Checking ${projects.length} watched projects:`,
      projects.map((p) => p.slug).join(', ')
    );

    let totalSent = 0;
    const results: any[] = [];

    for (const project of projects) {
      console.log(`\n=== Checking project: ${project.displayName} (${project.slug}) ===`);

      try {
        // KV'den bu proje için en son görülen change ID'sini al
        const kvKey = `last_change_id:${project.slug}`;
        const lastSeenId: number = (await kv.get<number>(kvKey)) ?? 0;
        console.log(`Last seen change ID for ${project.slug}: ${lastSeenId}`);

        const API_URL = `https://hosted.weblate.org/api/changes/?project=${project.slug}&language=en&page_size=20&ordering=-id`;
        console.log(`Fetching: ${API_URL}`);

        const response = await fetch(API_URL, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'WebtegBot/1.0',
          },
        });

        console.log(`Response status: ${response.status}`);

        if (!response.ok) {
          console.error(`API fetch failed for ${project.slug}: ${response.status}`);
          results.push({
            project: project.displayName,
            success: false,
            error: `HTTP ${response.status}`,
          });
          continue;
        }

        const data = await response.json();
        const allChanges: WeblateChange[] = data.results || [];
        console.log(`${project.displayName}: ${allChanges.length} changes fetched`);

        if (allChanges.length === 0) {
          results.push({
            project: project.displayName,
            success: true,
            changes_sent: 0,
            message: 'API boş döndü',
          });
          continue;
        }

        // Sadece daha önce görülmemiş (ID > lastSeenId) değişiklikleri al
        // API zaten ID azalan sırada geliyor; yeniden eskiye doğru işlemek için tersine çevir
        const newChanges = allChanges
          .filter((c) => c.id > lastSeenId)
          .reverse(); // Eskiden yeniye sırala, böylece mesajlar kronolojik gelir

        console.log(`${project.displayName}: ${newChanges.length} new changes (ID > ${lastSeenId})`);

        if (newChanges.length === 0) {
          results.push({
            project: project.displayName,
            success: true,
            changes_sent: 0,
            message: 'Yeni değişiklik yok',
          });
          continue;
        }

        // En fazla 5 bildirim gönder (spam önleme)
        const changesToSend = newChanges.slice(0, 5);
        let sentCount = 0;

        for (const change of changesToSend) {
          const componentName =
            change.component?.split('/').filter(Boolean).pop() || 'Bilinmiyor';

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
            change.user?.split('/').filter(Boolean).pop()?.replace(/:/g, ' ') ||
            'Anonim';

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
          if (sent) {
            sentCount++;
            totalSent++;
          }

          if (changesToSend.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        // En yüksek ID'yi KV'ye kaydet (tüm yeni değişiklikler işlendi)
        const maxId = Math.max(...newChanges.map((c) => c.id));
        await kv.set(kvKey, maxId);
        console.log(`Updated last seen ID for ${project.slug}: ${maxId}`);

        // Eğer 5'ten fazla yeni değişiklik varsa özet mesajı gönder
        const skipped = newChanges.length - changesToSend.length;
        if (skipped > 0) {
          const summaryMsg =
            `ℹ️ <b>${project.displayName}</b>: Toplam ${newChanges.length} yeni değişiklik vardı, ` +
            `${skipped} tanesi gösterilmedi (spam önleme). ` +
            `<a href="https://hosted.weblate.org/projects/${project.slug}/">Tümünü Weblate'te gör</a>`;
          await sendTelegramMessage(BOT_TOKEN, CHAT_ID, summaryMsg);
        }

        results.push({
          project: project.displayName,
          success: true,
          new_changes: newChanges.length,
          changes_sent: sentCount,
          new_last_id: maxId,
        });
      } catch (error) {
        console.error(`Error processing ${project.slug}:`, error);
        results.push({
          project: project.displayName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      if (projects.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`\n=== Execution completed in ${executionTime}ms ===`);

    return res.status(200).json({
      success: true,
      total_notifications: totalSent,
      projects_checked: projects.length,
      projects: results,
      execution_time_ms: executionTime,
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Global error:', error);
    return res.status(500).json({
      error: 'Check failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      execution_time_ms: executionTime,
    });
  }
}
