// /api/send-test — envoie une notification de test à tous les appareils d'un utilisateur.
// Sert à vérifier que la chaîne complète fonctionne (abonnement → push → téléphone).
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:valio@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { userId } = body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const { data: subs, error } = await supabase
      .from('push_subscriptions').select('endpoint, subscription').eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    if (!subs || !subs.length) return res.status(404).json({ error: 'Aucun appareil abonné' });

    const payload = JSON.stringify({
      title: '🔔 Valio — test réussi',
      body: 'Les notifications fonctionnent sur cet appareil.',
      url: '/',
      tag: 'valio-test',
    });

    let sent = 0;
    for (const s of subs) {
      try { await webpush.sendNotification(s.subscription, payload); sent++; }
      catch (err) {
        // Abonnement expiré/invalide → on le nettoie
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }
    return res.json({ ok: true, sent });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
