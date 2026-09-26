import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { recapPlugin } from './server/viteRecap';
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'GEMINI_');
  return {plugins:[react(),recapPlugin({apiKey:process.env.GEMINI_API_KEY||env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||env.GEMINI_MODEL})]};
});
