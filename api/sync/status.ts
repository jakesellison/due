import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';

import { authUser, providerStatuses } from '../../src/server/sync';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = await authUser(req, res);
  if (!userId) return;

  try {
    const providers = await providerStatuses(createAdminClient(), userId);
    res.status(200).json({ providers });
  } catch (err) {
    console.error('sync/status failed:', err);
    await captureError(err, { route: 'sync/status' });
    res.status(500).json({ error: 'Internal server error' });
  }
}
