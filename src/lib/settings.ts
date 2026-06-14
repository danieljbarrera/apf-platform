import { supabaseAdmin } from './supabase-admin';
import { currentSquareMode, type SquareEnv } from './square';

// The active Square mode is stored in app_settings so it can be flipped from the
// admin UI at runtime (no redeploy). Falls back to the SQUARE_MODE env var.
export async function getSquareMode(): Promise<SquareEnv> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'square_mode').maybeSingle();
    if (data?.value === 'production' || data?.value === 'sandbox') return data.value;
  } catch { /* fall through to env */ }
  return currentSquareMode();
}

export async function setSquareMode(mode: SquareEnv): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { key: 'square_mode', value: mode, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}
