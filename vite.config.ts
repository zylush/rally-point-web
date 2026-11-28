import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const stagingProject = 'iclrvvsiwypxlwrwgqia'
const productionProject = 'tuttbvwnlndcstmmxybb'
const pagesBase = '/rally-point-web/'

type Target = { label: 'Staging' | 'Production'; project: string; database: string; base: string }

// `staging` keeps the old GitHub Pages path. `vercel` serves the domain root: Vercel's production
// builds (brinely.info) must use the production project, every other Vercel build uses staging.
function targetFor(mode: string): Target | undefined {
  if (mode === 'staging') return { label: 'Staging', project: stagingProject, database: 'Rally-Point-Database', base: pagesBase }
  if (mode !== 'vercel') return undefined
  return process.env.VERCEL_ENV === 'production'
    ? { label: 'Production', project: productionProject, database: 'brinely-production', base: '/' }
    : { label: 'Staging', project: stagingProject, database: 'Rally-Point-Database', base: '/' }
}

// Build-time mistake prevention, not authorization or JWT signature validation.
// Opaque publishable keys need a separate read-only project association check.
function validateTarget(env: Record<string, string>, target: Target) {
  const { label, project, base } = target
  if (env.VITE_SUPABASE_URL !== `https://${project}.supabase.co`) {
    throw new Error(`${label} requires the approved ${target.database} URL.`)
  }
  if (env.VITE_BASE && env.VITE_BASE !== base) {
    throw new Error(`${label} requires the ${base} base path.`)
  }
  const key = env.VITE_SUPABASE_ANON_KEY ?? ''
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return
  try {
    const parts = key.split('.')
    if (parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (payload.role === 'anon' && payload.ref === project) return
    }
  } catch { /* Fail closed below without including credential values. */ }
  throw new Error(`${label} requires a browser-safe publishable key or matching legacy anon key.`)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = targetFor(mode)
  if (target) validateTarget(env, target)
  return {
    base: target?.base ?? (process.env.VITE_BASE || pagesBase),
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
