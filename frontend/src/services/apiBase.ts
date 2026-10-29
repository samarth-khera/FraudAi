/**
 * Base URL for every backend call (case API and V2 API).
 *
 * Local development leaves VITE_API_URL unset: requests stay same-origin and the Vite dev server proxies
 * /api and /health to http://127.0.0.1:8000. Production builds (Vercel) must set VITE_API_URL to the backend
 * origin, e.g. https://fraudshield-api.onrender.com; vite.config.ts refuses to build on Vercel without it.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
