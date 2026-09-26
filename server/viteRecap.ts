import type { Plugin } from 'vite';
import { recapHandler, type RecapSettings } from './recap';

/** Development/preview only. Production imports the HTTP handler directly. */
export function recapPlugin(settings:RecapSettings):Plugin {
  const handler=recapHandler(settings);
  return {name:'optional-session-recap',configureServer(server){server.middlewares.use(handler);},configurePreviewServer(server){server.middlewares.use(handler);}};
}
