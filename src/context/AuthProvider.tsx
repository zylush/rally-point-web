import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isDemoMode, supabase } from '../lib/supabase'
import { demoStore } from '../lib/demoStore'
import { api } from '../lib/api'
import {
  CLUB_UNAVAILABLE_EVENT,
  chooseActiveClub,
  getActiveClubId,
  rememberClub,
  setActiveClubId,
} from '../lib/clubContext'
import type { MyClub, Profile } from '../types'
import { AuthContext } from './AuthContext'

interface Access {
  profile: Profile
  clubs: MyClub[]
  activeClub: MyClub | null
}

/**
 * Works out where a person may act. Identity comes from profiles; authority
 * comes only from trusted club roles, memberships and platform roles, never
 * from profiles.role. Returns null when the person has no access anywhere.
 */
async function loadAccess(identity: Profile, preferredClubId?: string | null): Promise<Access | null> {
  const [clubs, platform] = await Promise.all([api.myClubs(identity.id), api.platformAccess(identity.id)])
  if (platform === 'superadmin') {
    // Platform accounts work in the platform portal only, with no club context.
    setActiveClubId(null)
    return { profile: { ...identity, role: 'superadmin' }, clubs: [], activeClub: null }
  }
  const activeClub = chooseActiveClub(clubs, identity.id, preferredClubId)
  if (!activeClub) {
    setActiveClubId(null)
    return null
  }
  setActiveClubId(activeClub.club_id)
  rememberClub(identity.id, activeClub.club_id)
  return { profile: { ...identity, role: activeClub.role }, clubs, activeClub }
}

async function fetchIdentity(userId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data as Profile | null) ?? null
}

const profileSetupError =
  'Your club profile is not ready. Please try again or contact staff.'

const invalidClubLinkError = 'This club link is not valid. Ask the club for a new link.'

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
  const [clubs, setClubs] = useState<MyClub[]>([])
  const [activeClub, setActiveClub] = useState<MyClub | null>(null)
  const [loading, setLoading] = useState(true)

  const applyAccess = useCallback((access: Access | null) => {
    if (!access) setActiveClubId(null)
    setUser(access?.profile ?? null)
    setClubs(access?.clubs ?? [])
    setActiveClub(access?.activeClub ?? null)
  }, [])

  const refresh = useCallback(async () => {
    if (isDemoMode) {
      try {
        const identity = demoStore.currentUser()
        applyAccess(identity ? await loadAccess(identity, getActiveClubId()) : null)
      } catch (error) {
        console.error(error)
        applyAccess(null)
      }
      setLoading(false)
      return
    }
    if (!supabase) {
      applyAccess(null)
      setLoading(false)
      return
    }
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id
    if (!uid) {
      applyAccess(null)
      setLoading(false)
      return
    }
    try {
      const identity = await fetchIdentity(uid)
      // Keep this tab's club across token refreshes when it is still allowed.
      const access = identity ? await loadAccess(identity, getActiveClubId()) : null
      if (!access) {
        applyAccess(null)
        await clearUnauthorizedSession()
      } else {
        applyAccess(access)
      }
    } catch (error) {
      console.error(error)
      applyAccess(null)
      await clearUnauthorizedSession()
    }
    setLoading(false)
  }, [applyAccess])

  useEffect(() => {
    void refresh()
    if (!isDemoMode && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange(() => {
        void refresh()
      })
      return () => sub.subscription.unsubscribe()
    }
  }, [refresh])

  // A club can be suspended while someone is using it; re-check where they may act.
  useEffect(() => {
    const recheck = () => void refresh()
    window.addEventListener(CLUB_UNAVAILABLE_EVENT, recheck)
    return () => window.removeEventListener(CLUB_UNAVAILABLE_EVENT, recheck)
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    if (isDemoMode) {
      const identity = demoStore.login(email, password)
      const access = await loadAccess(identity)
      if (!access) {
        demoStore.logout()
        applyAccess(null)
        throw new Error(profileSetupError)
      }
      applyAccess(access)
      return access.profile
    }
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const uid = data.user?.id
    if (!uid) throw new Error('No user returned')
    try {
      const identity = await fetchIdentity(uid)
      const access = identity ? await loadAccess(identity) : null
      if (!access) throw new Error(profileSetupError)
      applyAccess(access)
      return access.profile
    } catch {
      applyAccess(null)
      await clearUnauthorizedSession()
      throw new Error(profileSetupError)
    }
  }, [applyAccess])

  const signUpMember = useCallback(
    async (input: { email: string; password: string; full_name: string; phone?: string; clubSlug?: string }) => {
      const email = input.email.trim().toLowerCase()
      const full_name = input.full_name.trim()
      if (!full_name) throw new Error('Please enter your name')
      if (input.password.length < 6) throw new Error('Password must be at least 6 characters')

      // A join link names its club; check it before creating the account.
      const clubSlug = input.clubSlug?.trim() || undefined
      const joining = clubSlug ? await api.publicClub(clubSlug) : null
      if (clubSlug && !joining) throw new Error(invalidClubLinkError)

      if (isDemoMode) {
        const identity = demoStore.registerMember({
          email,
          password: input.password,
          full_name,
          phone: input.phone?.trim() || undefined,
          clubSlug,
        })
        const access = await loadAccess(identity, joining?.id)
        if (!access) throw new Error(profileSetupError)
        applyAccess(access)
        return access.profile
      }
      if (!supabase) throw new Error('Supabase not configured')

      // Public signup is always member — never admin/staff. Only the club link
      // is added to the sign-up details, and only when one was used.
      const details: Record<string, string | null> = { full_name, phone: input.phone?.trim() || null }
      if (clubSlug) details.club_slug = clubSlug
      const { data, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: { data: details },
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
        const identity = await fetchIdentity(data.user.id)
        const access = identity ? await loadAccess(identity, joining?.id) : null
        if (!access || access.profile.role !== 'member') throw new Error(profileSetupError)
        applyAccess(access)
        return access.profile
      } catch {
        applyAccess(null)
        await clearUnauthorizedSession()
        throw new Error(profileSetupError)
      }
    },
    [applyAccess],
  )

  const joinClub = useCallback(
    async (slug: string, options?: { asPlayer?: boolean }) => {
      if (!user) throw new Error('Please sign in to join a club')
      // As a player: no membership, just enough to book there. A join link keeps its own terms.
      const clubId = options?.asPlayer
        ? await api.joinClubAsPlayer(user.id, slug)
        : await api.joinClub(user.id, slug)
      const identity = isDemoMode ? demoStore.currentUser() : await fetchIdentity(user.id)
      const access = identity ? await loadAccess(identity, clubId) : null
      if (!access?.activeClub) throw new Error(profileSetupError)
      applyAccess(access)
      return access.activeClub
    },
    [user, applyAccess],
  )

  const switchClub = useCallback(
    (clubId: string) => {
      if (!user) return
      const next = clubs.find((club) => club.club_id === clubId)
      if (!next) return
      setActiveClubId(next.club_id)
      rememberClub(user.id, next.club_id)
      setActiveClub(next)
      setUser({ ...user, role: next.role })
    },
    [user, clubs],
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
      applyAccess(null)
      return
    }
    if (supabase) await supabase.auth.signOut()
    applyAccess(null)
  }, [applyAccess])

  const value = useMemo(
    () => ({
      user,
      loading,
      demo: isDemoMode,
      clubs,
      activeClub,
      switchClub,
      joinClub,
      signIn,
      signUpMember,
      resetPassword,
      signOut,
      refresh,
    }),
    [user, loading, clubs, activeClub, switchClub, joinClub, signIn, signUpMember, resetPassword, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
