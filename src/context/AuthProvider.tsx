import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isDemoMode, supabase } from '../lib/supabase'
import { demoStore } from '../lib/demoStore'
import type { Profile } from '../types'
import { AuthContext } from './AuthContext'

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data as Profile | null
}

const profileSetupError =
  'Your club profile is not ready. Please try again or contact staff.'

async function clearUnauthorizedSession() {
  if (!supabase) return
  try {
    const { error } = await supabase.auth.signOut()
    if (error) console.error(error)
  } catch (error) {
    console.error(error)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (isDemoMode) {
      setUser(demoStore.currentUser())
      setLoading(false)
      return
    }
    if (!supabase) {
      setUser(null)
      setLoading(false)
      return
    }
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id
    if (!uid) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const profile = await fetchProfile(uid)
      if (!profile) {
        setUser(null)
        await clearUnauthorizedSession()
      } else {
        setUser(profile)
      }
    } catch (error) {
      console.error(error)
      setUser(null)
      await clearUnauthorizedSession()
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    if (!isDemoMode && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange(() => {
        void refresh()
      })
      return () => sub.subscription.unsubscribe()
    }
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    if (isDemoMode) {
      const profile = demoStore.login(email, password)
      setUser(profile)
      return profile
    }
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const uid = data.user?.id
    if (!uid) throw new Error('No user returned')
    try {
      const profile = await fetchProfile(uid)
      if (!profile) throw new Error(profileSetupError)
      setUser(profile)
      return profile
    } catch {
      setUser(null)
      await clearUnauthorizedSession()
      throw new Error(profileSetupError)
    }
  }, [])

  const signUpMember = useCallback(
    async (input: { email: string; password: string; full_name: string; phone?: string }) => {
      const email = input.email.trim().toLowerCase()
      const full_name = input.full_name.trim()
      if (!full_name) throw new Error('Please enter your name')
      if (input.password.length < 6) throw new Error('Password must be at least 6 characters')

      if (isDemoMode) {
        const profile = demoStore.registerMember({
          email,
          password: input.password,
          full_name,
          phone: input.phone?.trim() || undefined,
        })
        setUser(profile)
        return profile
      }
      if (!supabase) throw new Error('Supabase not configured')

      // Public signup is always member — never admin/staff
      const { data, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: {
          data: {
            full_name,
            phone: input.phone?.trim() || null,
          },
        },
      })
      if (error) throw error
      if (!data.user) throw new Error('Sign-up failed')

      // If email confirmation is ON, session may be null
      if (!data.session) {
        throw new Error(
          'Check your email to confirm your account, then log in. (Or turn off email confirm in Supabase Auth for instant join.)',
        )
      }

      try {
        const profile = await fetchProfile(data.user.id)
        if (!profile || profile.role !== 'member') throw new Error(profileSetupError)
        setUser(profile)
        return profile
      } catch {
        setUser(null)
        await clearUnauthorizedSession()
        throw new Error(profileSetupError)
      }
    },
    [],
  )

  const resetPassword = useCallback(async (email: string) => {
    if (isDemoMode) {
      return
    }
    if (!supabase) throw new Error('Supabase not configured')
    const normalizedEmail = email.trim().toLowerCase()
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail)
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (isDemoMode) {
      demoStore.logout()
      setUser(null)
      return
    }
    if (supabase) await supabase.auth.signOut()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      demo: isDemoMode,
      signIn,
      signUpMember,
      resetPassword,
      signOut,
      refresh,
    }),
    [user, loading, signIn, signUpMember, resetPassword, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
