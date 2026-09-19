import { createContext, useContext } from 'react'
import type { Profile } from '../types'

interface AuthState {
  user: Profile | null
  loading: boolean
  demo: boolean
  signIn: (email: string, password: string) => Promise<Profile>
  /** Public join — always creates a member (never admin/staff). */
  signUpMember: (input: {
    email: string
    password: string
    full_name: string
    phone?: string
  }) => Promise<Profile>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
