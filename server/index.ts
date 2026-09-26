import { fileURLToPath } from 'node:url';
import { createProductionServer, productionPort } from './app';

try {
  const port=productionPort(process.env.PORT);
  const server=await createProductionServer({
    // Keep the built server outside the public frontend folder
    distDirectory:fileURLToPath(new URL('../dist/',import.meta.url)),
    recap:{apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL},
  });
  server.on('error',()=>{console.error('RepReady could not listen. Check the local port and service configuration.');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.info(`RepReady listening on http://127.0.0.1:${port}`));
  let closing=false;
  const shutdown=()=>{
    if(closing)return;closing=true;
    const deadline=setTimeout(()=>{server.closeAllConnections();process.exit(1);},10000);deadline.unref();
    server.close(()=>{clearTimeout(deadline);process.exit(0);});
  };
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}catch {
  console.error('RepReady could not start. Run npm run build and check PORT and frontend file permissions.');
  process.exitCode=1;
}
