// api/weblate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

interface WeblatePayload {
  event?: string;
  project?: { name: string; slug: string };
  component?: { name: string; slug: string };
  translation?: { language: string };
  user?: { username: string; full_name: string };
  change?: { action_name: string; target: string };
  comment?: { comment: string };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Sadece POST isteklerini kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Environment variables kontrolü
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Opsiyonel güvenlik

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Missing configuration' });
  }

  // Webhook secret doğrulama (varsa)
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers['x-hub-signature'] || req.query.secret;
    if (providedSecret !== WEBHOOK_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
  }

  try {
    const data: WeblatePayload = req.body;

    // Mesajı formatla
    let message = '🔔 <b>Weblate Bildirimi</b>\n\n';

    if (data.project) {
      message += `📦 <b>Proje:</b> ${data.project.name}\n`;
    }

    if (data.component) {
      message += `🧩 <b>Bileşen:</b> ${data.component.name}\n`;
    }

    if (data.translation?.language) {
      message += `🌐 <b>Dil:</b> ${data.translation.language}\n`;
    }

    if (data.event) {
      const eventEmojis: Record<string, string> = {
        'new_string': '✨ Yeni metin eklendi',
        'new_translation': '📝 Yeni çeviri',
        'new_contributor': '👤 Yeni katkıcı',
        'new_comment': '💬 Yeni yorum',
        'new_suggestion': '💡 Yeni öneri',
        'component_update': '🔄 Bileşen güncellendi',
      };
      message += `⚡ <b>Olay:</b> ${eventEmojis[data.event] || data.event}\n`;
    }

    if (data.user) {
      message += `👤 <b>Kullanıcı:</b> ${data.user.full_name || data.user.username}\n`;
    }

    if (data.change?.action_name) {
      message += `🎯 <b>Aksiyon:</b> ${data.change.action_name}\n`;
    }

    if (data.change?.target) {
      message += `\n📄 <code>${data.change.target}</code>\n`;
    }

    if (data.comment?.comment) {
      message += `\n💬 "${data.comment.comment}"\n`;
    }

    // Telegram'a gönder
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

    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      console.error('Telegram API error:', errorData);
      return res.status(500).json({ error: 'Telegram API failed', details: errorData });
    }

    return res.status(200).json({ success: true, message: 'Notification sent' });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
