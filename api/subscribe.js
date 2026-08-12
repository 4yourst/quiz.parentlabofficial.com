/**
 * POST /api/subscribe  —  Vercel serverless function.
 *
 * Adds a quiz lead to MailerLite (new API, connect.mailerlite.com) without ever
 * exposing the API key to the browser.
 *
 * Required environment variable (Vercel → Settings → Environment Variables):
 *   MAILERLITE_API_KEY   your MailerLite API token
 * Optional:
 *   MAILERLITE_GROUP_ID  numeric ID of the group whose "subscriber joins group"
 *                        trigger starts your onboarding automation
 *
 * Body: { email: string, profile?: string, product?: string }
 * The quiz profile/product are stored as MailerLite custom fields
 * `quiz_profile` / `quiz_product` when those fields exist in your account,
 * and silently dropped when they don't.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    console.error('MAILERLITE_API_KEY is not set');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { email, profile, product } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(422).json({ error: 'Invalid email address' });
  }

  const payload = { email: email.trim().toLowerCase() };

  const fields = {};
  if (typeof profile === 'string' && profile) fields.quiz_profile = profile.slice(0, 190);
  if (typeof product === 'string' && product) fields.quiz_product = product.slice(0, 190);
  if (Object.keys(fields).length) payload.fields = fields;

  if (process.env.MAILERLITE_GROUP_ID) {
    payload.groups = [process.env.MAILERLITE_GROUP_ID];
  }

  const send = body =>
    fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

  try {
    let r = await send(payload);

    // If the custom fields don't exist in this MailerLite account, retry with
    // just the email rather than losing the lead.
    if (r.status === 422 && payload.fields) {
      const detail = await r.json().catch(() => ({}));
      const isFieldError =
        detail.errors && Object.keys(detail.errors).some(k => k.startsWith('fields'));
      if (!isFieldError) {
        return res.status(422).json({ error: detail.message || 'Invalid email address' });
      }
      const { fields: _dropped, ...bare } = payload;
      r = await send(bare);
    }

    if (r.ok) {
      // 201 = new subscriber, 200 = existing one updated — both are a win.
      return res.status(200).json({ ok: true });
    }

    if (r.status === 422) {
      const detail = await r.json().catch(() => ({}));
      return res.status(422).json({ error: detail.message || 'Invalid email address' });
    }

    console.error('MailerLite error', r.status, await r.text().catch(() => ''));
    return res.status(502).json({ error: 'Email service unavailable' });
  } catch (err) {
    console.error('MailerLite request failed', err);
    return res.status(502).json({ error: 'Email service unavailable' });
  }
};
