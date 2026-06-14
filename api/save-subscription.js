// /api/save-subscription — enregistre (ou supprime) l'abonnement push d'un utilisateur.
// Utilise la clé service_role de Supabase (secrète, côté serveur) pour écrire en base.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { userId, subscription, action } = body || {};
    if (!userId || !subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'userId + subscription requis' });
    }

    if (action === 'delete') {
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      return res.json({ ok: true, deleted: true });
    }

    // upsert sur l'endpoint (un appareil = un endpoint unique)
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      subscription: subscription,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
