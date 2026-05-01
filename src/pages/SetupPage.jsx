import { useState } from 'react'
import { supabase } from '../lib/supabase'

const C = { ink:'#1A2340', gold:'#C4882A', white:'#FFFFFF', surface:'#FFFFFF',
  border:'#DDD8CC', inkMuted:'#8A90A8', jade:'#2A7D5C', crimson:'#A8281C' }

export default function SetupPage() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    orgName: '', adminName: '', adminEmail: '', password: '', confirm: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleCreate() {
    if (form.password !== form.confirm) { setError('Wachtwoorden komen niet overeen'); return }
    if (form.password.length < 8) { setError('Wachtwoord minimaal 8 tekens'); return }
    setLoading(true); setError('')
    try {
      // 1. Create auth user
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.adminEmail, password: form.password,
        options: { data: { name: form.adminName } }
      })
      if (authErr) throw authErr

      // 2. Create organisation
      const { data: org, error: orgErr } = await supabase
        .from('organisations').insert({ name: form.orgName }).select().single()
      if (orgErr) throw orgErr

      // 3. Create admin staff record
      const { error: staffErr } = await supabase.from('staff').insert({
        org_id: org.id, auth_id: authData.user.id,
        name: form.adminName, email: form.adminEmail,
        is_admin: true, is_active: true,
        contract_type: 'vast', contract_hours: 40,
      })
      if (staffErr) throw staffErr

      // 4. Create default settings
      await supabase.from('org_settings').insert({ org_id: org.id })

      // 5. Create default shifts via function
      await supabase.rpc('create_default_shifts', { p_org_id: org.id })

      setDone(true)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const inp = (label, key, type='text', ph='') => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{label}</div>
      <input type={type} value={form[key]} onChange={f(key)} placeholder={ph}
        style={{ width: '100%', padding: '12px 14px', borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)',
          color: C.white, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}/>
    </div>
  )

  if (done) return (
    <div style={{ minHeight:'100vh', background:C.ink, display:'flex', alignItems:'center',
      justifyContent:'center', padding:24, fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ textAlign:'center', maxWidth:380 }}>
        <div style={{ fontSize:60, marginBottom:20 }}>✅</div>
        <div style={{ color:C.white, fontSize:22, fontWeight:900, marginBottom:10 }}>Restaurant aangemaakt!</div>
        <div style={{ color:'rgba(255,255,255,0.5)', fontSize:14, marginBottom:24, lineHeight:1.6 }}>
          Controleer je e-mail ({form.adminEmail}) om je account te bevestigen, dan kun je inloggen.
        </div>
        <a href="/" style={{ display:'block', padding:'14px', background:C.gold,
          color:C.white, borderRadius:12, textDecoration:'none', fontWeight:700, fontSize:15 }}>
          Naar inloggen
        </a>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:C.ink, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', padding:24,
      fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <div style={{ width:64, height:64, borderRadius:20, background:C.gold,
          fontSize:28, margin:'0 auto 12px', display:'flex', alignItems:'center',
          justifyContent:'center', boxShadow:`0 0 40px ${C.gold}55` }}>🍽</div>
        <div style={{ color:C.white, fontSize:26, fontWeight:900 }}>RoosterAI instellen</div>
        <div style={{ color:'rgba(255,255,255,0.3)', fontSize:12, marginTop:4 }}>
          Stap {step} van 2
        </div>
      </div>

      <div style={{ width:'100%', maxWidth:380 }}>
        {step === 1 && <>
          <div style={{ color:'rgba(255,255,255,0.7)', fontWeight:700, marginBottom:16 }}>Restaurant gegevens</div>
          {inp('NAAM RESTAURANT', 'orgName', 'text', 'Bijv. Restaurant De Smidse')}
          <button onClick={() => { if (!form.orgName) return; setStep(2) }}
            style={{ width:'100%', padding:'14px', borderRadius:12, border:'none',
              background:C.gold, color:C.white, fontSize:15, fontWeight:700,
              cursor:'pointer', fontFamily:'inherit' }}>
            Volgende →
          </button>
        </>}

        {step === 2 && <>
          <div style={{ color:'rgba(255,255,255,0.7)', fontWeight:700, marginBottom:16 }}>Admin account</div>
          {inp('JOUW NAAM', 'adminName', 'text', 'Voornaam achternaam')}
          {inp('E-MAILADRES', 'adminEmail', 'email', 'naam@restaurant.nl')}
          {inp('WACHTWOORD', 'password', 'password', 'Minimaal 8 tekens')}
          {inp('HERHAAL WACHTWOORD', 'confirm', 'password', '')}
          {error && <div style={{ background:'rgba(168,40,28,0.2)', border:'1px solid rgba(168,40,28,0.4)',
            borderRadius:10, padding:'10px 14px', marginBottom:16, color:'#FF8C72', fontSize:13 }}>
            {error}
          </div>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setStep(1)} style={{ flex:1, padding:'14px', borderRadius:12,
              border:'1px solid rgba(255,255,255,0.15)', background:'transparent',
              color:'rgba(255,255,255,0.6)', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              ← Terug
            </button>
            <button onClick={handleCreate} disabled={loading} style={{ flex:2, padding:'14px',
              borderRadius:12, border:'none', background:loading?'rgba(255,255,255,0.2)':C.jade,
              color:C.white, fontSize:15, fontWeight:700,
              cursor:loading?'not-allowed':'pointer', fontFamily:'inherit' }}>
              {loading ? 'Aanmaken...' : '✓ Restaurant aanmaken'}
            </button>
          </div>
        </>}
      </div>
    </div>
  )
}
