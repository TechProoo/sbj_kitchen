import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 5173 is the customer site; the kitchen board sits alongside it.
  server: { port: 5174 },
});
