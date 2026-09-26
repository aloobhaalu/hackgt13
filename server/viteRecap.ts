import type { Plugin } from 'vite';
import { recapHandler, type RecapSettings } from './recap';

// Use this adapter for dev and preview
// Production uses the HTTP handler directly
export function recapPlugin(settings:RecapSettings):Plugin {
  const handler=recapHandler(settings);
  return {name:'optional-session-recap',configureServer(server){server.middlewares.use(handler);},configurePreviewServer(server){server.middlewares.use(handler);}};
}
