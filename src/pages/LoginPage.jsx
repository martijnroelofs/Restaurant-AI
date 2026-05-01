import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

const C = {
  ink: '#1A2340', gold: '#C4882A', terra: '#B84C2C',
  crimson: '#A8281C', white: '#FFFFFF',
  surface: '#FFFFFF', border: '#DDD8CC',
  inkMuted: '#8A90A8', inkMid: '#3D4460',
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) {
      setError('Onjuist e-mailadres of wachtwoord')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.ink,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22,
          background: C.gold, fontSize: 32, margin: '0 auto 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 50px ${C.gold}55`,
        }}>🍽</div>
        <div style={{ color: C.white, fontSize: 30, fontWeight: 900, letterSpacing: '-0.02em' }}>
          RoosterAI
        </div>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 5, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Horeca Planning
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.04em' }}>
            E-MAILADRES
          </div>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="naam@restaurant.nl" required autoComplete="email"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1px solid rgba(255,255,255,0.12)`,
              background: 'rgba(255,255,255,0.07)', color: C.white,
              fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.04em' }}>
            WACHTWOORD
          </div>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" required autoComplete="current-password"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1px solid rgba(255,255,255,0.12)`,
              background: 'rgba(255,255,255,0.07)', color: C.white,
              fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{
            background: 'rgba(168,40,28,0.2)', border: '1px solid rgba(168,40,28,0.4)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            color: '#FF8C72', fontSize: 13, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '14px', borderRadius: 12, border: 'none',
          background: loading ? 'rgba(255,255,255,0.2)' : C.gold,
          color: C.white, fontSize: 15, fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', transition: 'all .2s',
        }}>
          {loading ? 'Inloggen...' : 'Inloggen'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/setup" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textDecoration: 'none' }}>
            Eerste keer? → Restaurant instellen
          </a>
        </div>
      </form>
    </div>
  )
}
