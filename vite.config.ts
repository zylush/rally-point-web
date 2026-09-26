import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const stagingProject = 'iclrvvsiwypxlwrwgqia'
const pagesBase = '/rally-point-web/'

// Build-time mistake prevention, not authorization or JWT signature validation.
// Opaque publishable keys need a separate read-only project association check.
function validateStaging(env: Record<string, string>) {
  if (env.VITE_SUPABASE_URL !== `https://${stagingProject}.supabase.co`) {
    throw new Error('Staging requires the approved Rally-Point-Database URL.')
  }
  if (env.VITE_BASE && env.VITE_BASE !== pagesBase) {
    throw new Error('Staging requires the /rally-point-web/ base path.')
  }
  const key = env.VITE_SUPABASE_ANON_KEY ?? ''
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return
  try {
    const parts = key.split('.')
    if (parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (payload.role === 'anon' && payload.ref === stagingProject) return
    }
  } catch { /* Fail closed below without including credential values. */ }
  throw new Error('Staging requires a browser-safe publishable key or matching legacy anon key.')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  if (mode === 'staging') validateStaging(env)
  return {
    base: mode === 'staging' ? pagesBase : process.env.VITE_BASE || pagesBase,
    // Keep the reviewed staging artifact separate from the legacy deploy script.
    build: { outDir: mode === 'staging' ? 'staging-artifact.local' : 'dist' },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: true,
    },
  }
})
