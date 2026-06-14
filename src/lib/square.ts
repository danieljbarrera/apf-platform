import { SquareClient, SquareEnvironment } from 'square';

export type SquareEnv = 'sandbox' | 'production';

// Which environment NEW invoices are created in. Existing events use their own
// stored `square_env`, so flipping this never breaks already-created invoices.
export function currentSquareMode(): SquareEnv {
  const m = (process.env.SQUARE_MODE || process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase();
  return m === 'production' ? 'production' : 'sandbox';
}

function creds(env: SquareEnv): { token: string; locationId: string } {
  if (env === 'production') {
    return { token: process.env.SQUARE_PROD_TOKEN || '', locationId: process.env.SQUARE_PROD_LOCATION_ID || '' };
  }
  // Sandbox falls back to the original single-env vars for an easy migration
  return {
    token: process.env.SQUARE_SANDBOX_TOKEN || process.env.SQUARE_TOKEN || '',
    locationId: process.env.SQUARE_SANDBOX_LOCATION_ID || process.env.SQUARE_LOCATION_ID || '',
  };
}

// Returns a client + location for a specific environment.
export function squareFor(env: SquareEnv) {
  const { token, locationId } = creds(env);
  const client = new SquareClient({
    token,
    environment: env === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });
  return { client, locationId, env };
}

export function dashHostFor(env: SquareEnv): string {
  return env === 'production' ? 'https://app.squareup.com' : 'https://app.squareupsandbox.com';
}

// Current-mode defaults (back-compat for any caller that doesn't specify an env)
const _cur = squareFor(currentSquareMode());
export const squareClient = _cur.client;
export const squareLocationId = _cur.locationId;
