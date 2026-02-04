import type { Env, Storage } from '../storage';
import { json } from '../utils';

function unauthorized() {
  return json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function handleAdminApi(req: Request, env: Env, storage: Storage): Promise<Response> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== (env as any).ADMIN_PANEL_TOKEN) return unauthorized();

  const url = new URL(req.url);
  const path = url.pathname.replace('/admin/api', '');

  const body = await req.json().catch(() => ({} as any));

  if (path === '/wallet') {
    await storage.setWalletPublic(String(body.wallet || ''));
    // owner alarm handled in bot commands; admin panel doesn't notify automatically.
    return json({ ok: true });
  }

  if (path === '/limits') {
    const limits = {
      freeDaily: Number(body.freeDaily || 50),
      freeMonthly: Number(body.freeMonthly || 500),
      subDaily: Number(body.subDaily || 50),
    };
    await storage.setLimits(limits);
    return json({ ok: true, limits });
  }

  if (path === '/banner') {
    const banner = { enabled: !!body.enabled, text: String(body.text || ''), url: String(body.url || '') };
    await storage.setBanner(banner);
    return json({ ok: true, banner });
  }

  if (path === '/prompt') {
    const key = String(body.key || '');
    const value = String(body.value || '');
    if (!key) return json({ ok: false, error: 'missing key' }, { status: 400 });
    await storage.setPrompt(key, value);
    return json({ ok: true, key });
  }

  if (path === '/payments') {
    const pending = await storage.listPendingPayments(100);
    return json({ ok: true, pending });
  }

  return json({ ok: false, error: 'not_found' }, { status: 404 });
}
