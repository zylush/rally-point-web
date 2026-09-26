// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from 'vite'

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }))
vi.mock('vite', async (original) => ({
  ...await original<typeof import('vite')>(),
  loadEnv: vi.fn(() => ({ ...env })),
}))
import config from '../vite.config'

const project = 'iclrvvsiwypxlwrwgqia'
const url = `https://${project}.supabase.co`
const token = (role = 'anon', ref = project) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.test-signature`

async function settings(mode = 'staging'): Promise<UserConfig> {
  return typeof config === 'function' ? config({ command: 'build', mode }) : config
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key]
  env.VITE_SUPABASE_URL = url
  env.VITE_SUPABASE_ANON_KEY = token()
  vi.stubEnv('VITE_BASE', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('staging build target', () => {
  it('isolates the staging artifact from ordinary dist and fixes the Pages base', async () => {
    const result = await settings()
    expect(result.base).toBe('/rally-point-web/')
    expect(result.build?.outDir).toBe('staging-artifact.local')
  })

  it.each(['', ' ', 'https://ausgoiwwhevrplfetccm.supabase.co', `http://${project}.supabase.co`, `${url}/other`, `${url}?key=hidden`])('rejects a missing or wrong project URL (%s)', async (value) => {
    env.VITE_SUPABASE_URL = value
    await expect(settings()).rejects.toThrow('Staging requires')
  })

  it.each(['', ' ', 'sb_secret_never-ship', 'not-a-key', 'eyJ.bad.signature', token('service_role'), token('authenticated'), token('anon', 'ausgoiwwhevrplfetccm')])('rejects missing, malformed, elevated, and foreign browser keys without echoing them', async (key) => {
    env.VITE_SUPABASE_ANON_KEY = key
    await expect(settings()).rejects.toThrow('Staging requires')
    try { await settings() } catch (error) {
      if (key.trim()) expect((error as Error).message).not.toContain(key)
    }
  })

  it('accepts publishable keys (project association still needs a read-only server check)', async () => {
    env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test-key-not-a-real-credential'
    expect((await settings()).build?.outDir).toBe('staging-artifact.local')
  })

  it('rejects a base-path override for another website', async () => {
    env.VITE_BASE = '/wrong/'
    await expect(settings()).rejects.toThrow('Staging requires')
  })

  it.each(['development', 'production'])('preserves blank-env demo configuration in %s mode', async (mode) => {
    env.VITE_SUPABASE_URL = ''
    env.VITE_SUPABASE_ANON_KEY = ''
    const result = await settings(mode)
    expect(result.base).toBe('/rally-point-web/')
    expect(result.build?.outDir ?? 'dist').toBe('dist')
  })
})
