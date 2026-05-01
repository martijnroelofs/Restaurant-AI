import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
export async function getMyStaff() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('staff')
    .select('*')
    .eq('auth_id', user.id)
    .single()
  return data
}

export async function getMyOrg() {
  const me = await getMyStaff()
  if (!me) return null
  const { data } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', me.org_id)
    .single()
  return data
}

// ─── Realtime roster subscription ─────────────────────────────────────────────
export function subscribeToRoster(orgId, weekStart, callback) {
  return supabase
    .channel(`roster_${orgId}_${weekStart}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'roster_assignments',
    }, callback)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rosters',
    }, callback)
    .subscribe()
}

// ─── Push notifications ───────────────────────────────────────────────────────
export async function registerPushSubscription(staffId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push not supported')
    return false
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
    })
    const { endpoint, keys } = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      staff_id: staffId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    }, { onConflict: 'staff_id,endpoint' })
    return true
  } catch (e) {
    console.error('Push registration failed:', e)
    return false
  }
}
