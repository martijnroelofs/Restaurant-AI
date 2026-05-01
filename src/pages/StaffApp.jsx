import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase, registerPushSubscription } from '../lib/supabase'
import { C, DEPTS, Badge, Card, Avatar, Toast, WeekNav, btn, getWeekDates, getMondayOfWeek, formatDate, DAYS, DAYS_FULL } from '../components/ui'

function getWeeks() {
  const weeks = [], now = new Date()
  const start = new Date(getMondayOfWeek(new Date(now.getFullYear(), now.getMonth() - 1, 1)))
  for (let i = 0; i < 12; i++) {
    const mon = new Date(start); mon.setDate(start.getDate() + i * 7)
    const monStr = mon.toISOString().split('T')[0]
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    weeks.push({ monday:monStr, label:`${formatDate(monStr)} – ${formatDate(sun.toISOString().split('T')[0])}`, dates:getWeekDates(monStr) })
  }
  return weeks
}

export default function StaffApp() {
  const { staff: me, signOut } = useAuth()
  const [tab, setTab] = useState('rooster')
  const [weekIdx, setWeekIdx] = useState(3)
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(true)

  // Data
  const [myAssignments, setMyAssignments] = useState({}) // { monday: [shift×7] }
  const [rosterStatus, setRosterStatus] = useState({})   // { monday: status }
  const [shiftTemplates, setShiftTemplates] = useState({})
  const [allStaff, setAllStaff] = useState([])
  const [leaveRequests, setLeaveRequests] = useState([])
  const [swapRequests, setSwapRequests] = useState([])
  const [availPatterns, setAvailPatterns] = useState({})
  const [availOverrides, setAvailOverrides] = useState({})
  const [pushEnabled, setPushEnabled] = useState(false)

  const weeks = getWeeks()
  const currentWeek = weeks[weekIdx]
  const show = msg => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  useEffect(() => {
    if (!me) return
    loadAll()

    // Subscribe to roster publish events
    const sub = supabase.channel(`staff_${me.id}`)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'rosters',
        filter:`org_id=eq.${me.org_id}` }, payload => {
        if (payload.new.status === 'published') {
          show('📅 Nieuw rooster gepubliceerd! Bekijk je diensten.')
          loadAssignments()
        }
      })
      .subscribe()

    return () => supabase.removeChannel(sub)
  }, [me])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadAssignments(), loadShifts(), loadStaff(), loadLeaves(), loadSwaps(), loadAvailability()])
    setLoading(false)
  }

  async function loadAssignments() {
    const { data: rosters } = await supabase.from('rosters').select('*').eq('org_id', me.org_id)
    const statusMap = {}
    ;(rosters || []).forEach(r => { statusMap[r.week_start] = r.status })
    setRosterStatus(statusMap)

    const rIds = (rosters || []).map(r => r.id)
    if (!rIds.length) return

    const { data: asgn } = await supabase.from('roster_assignments')
      .select('*').eq('staff_id', me.id).in('roster_id', rIds)

    const byWeek = {}
    ;(asgn || []).forEach(a => {
      const roster = rosters.find(r => r.id === a.roster_id)
      if (!roster) return
      const wk = roster.week_start
      if (!byWeek[wk]) byWeek[wk] = Array(7).fill(null)
      const di = getWeekDates(wk).indexOf(a.date)
      if (di >= 0) byWeek[wk][di] = a.shift_name
    })
    setMyAssignments(byWeek)
  }

  async function loadShifts() {
    const { data } = await supabase.from('shift_templates').select('*').eq('org_id', me.org_id)
    const map = {}
    ;(data || []).forEach(s => { map[s.name] = s })
    setShiftTemplates(map)
  }

  async function loadStaff() {
    const { data } = await supabase.from('staff').select('id,name,color,depts').eq('org_id', me.org_id).eq('is_active', true)
    setAllStaff(data || [])
  }

  async function loadLeaves() {
    const { data } = await supabase.from('leave_requests').select('*').eq('staff_id', me.id)
    setLeaveRequests(data || [])
  }

  async function loadSwaps() {
    const { data } = await supabase.from('swap_requests')
      .select('*, to_staff:staff!to_staff_id(name), from_staff:staff!from_staff_id(name)')
      .or(`from_staff_id.eq.${me.id},to_staff_id.eq.${me.id}`)
    setSwapRequests(data || [])
  }

  async function loadAvailability() {
    const { data: pats } = await supabase.from('availability_patterns').select('*').eq('staff_id', me.id)
    const { data: ovs } = await supabase.from('availability_overrides').select('*').eq('staff_id', me.id)
    const patMap = {}
    ;(pats || []).forEach(p => { patMap[p.day_of_week] = p.slots })
    const ovMap = {}
    ;(ovs || []).forEach(o => { ovMap[o.date] = o.slots })
    setAvailPatterns(patMap)
    setAvailOverrides(ovMap)
  }

  async function enablePush() {
    const ok = await registerPushSubscription(me.id)
    setPushEnabled(ok)
    show(ok ? '✓ Pushmeldingen ingeschakeld!' : 'Push niet ondersteund op dit apparaat')
  }

  async function savePattern(dayOfWeek, slots) {
    await supabase.from('availability_patterns').upsert({ staff_id:me.id, day_of_week:dayOfWeek, slots }, { onConflict:'staff_id,day_of_week' })
    setAvailPatterns(p => ({ ...p, [dayOfWeek]: slots }))
  }

  async function saveOverride(date, slots) {
    if (slots === undefined) {
      await supabase.from('availability_overrides').delete().eq('staff_id', me.id).eq('date', date)
      setAvailOverrides(o => { const n = {...o}; delete n[date]; return n })
    } else {
      await supabase.from('availability_overrides').upsert({ staff_id:me.id, date, slots }, { onConflict:'staff_id,date' })
      setAvailOverrides(o => ({ ...o, [date]: slots }))
    }
  }

  async function requestLeave(date, reason) {
    const { error } = await supabase.from('leave_requests').insert({ staff_id:me.id, date, reason })
    if (error) { show('Fout: ' + error.message); return }
    await loadLeaves()
    show('✓ Vrije dag aangevraagd')
  }

  async function requestSwap(fromDate, toStaffId, toDate) {
    const { error } = await supabase.from('swap_requests').insert({
      from_staff_id:me.id, to_staff_id:toStaffId, from_date:fromDate, to_date:toDate
    })
    if (error) { show('Fout: ' + error.message); return }
    await loadSwaps()
    show('✓ Ruilverzoek verstuurd')
  }

  const schedule = myAssignments[currentWeek.monday] || Array(7).fill(null)
  const status = rosterStatus[currentWeek.monday]
  const isPublished = status === 'published'
  const totalH = schedule.reduce((a, sh) => {
    const t = sh && shiftTemplates[sh]
    return a + (t ? (parseTime(t.end_time) - parseTime(t.start_time) - t.break_minutes) / 60 : 0)
  }, 0)

  const tabs = [
    { id:'rooster',      icon:'📅', l:'Rooster' },
    { id:'beschikbaar',  icon:'✏️',  l:'Beschikbaar' },
    { id:'vrij',         icon:'🏖',  l:'Vrij' },
    { id:'ruilen',       icon:'🔄',  l:'Ruilen' },
  ]

  if (loading) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}><div style={{ fontSize:40, marginBottom:8 }}>🍽</div><div style={{ color:C.inkMuted }}>Laden...</div></div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:"'DM Sans','Segoe UI',sans-serif", maxWidth:500, margin:'0 auto' }}>
      {toast && <Toast msg={toast} />}

      {/* Header */}
      <div style={{ background:C.ink, padding:'18px 18px 0', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Avatar name={me.name} color={me.color} size={40}/>
            <div>
              <div style={{ color:C.white, fontWeight:800, fontSize:15 }}>{me.name.split(' ')[0]}</div>
              <div style={{ color:'rgba(255,255,255,0.38)', fontSize:11 }}>
                {me.depts?.map(d => DEPTS[d]?.icon).join(' ')} · {totalH.toFixed(0)}u
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {!pushEnabled && (
              <button onClick={enablePush}
                style={{ ...btn(), background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)',
                  padding:'6px 10px', fontSize:11, borderRadius:8 }}>🔔</button>
            )}
            <button onClick={signOut}
              style={{ ...btn(), background:'rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.45)',
                padding:'6px 12px', fontSize:12, borderRadius:8 }}>Uit</button>
          </div>
        </div>
        <div style={{ display:'flex' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...btn(), flex:1, background:'transparent', borderRadius:0,
                color:tab===t.id?C.white:'rgba(255,255,255,0.32)',
                padding:'9px 4px 13px', fontSize:10, fontWeight:700,
                borderBottom:`3px solid ${tab===t.id?C.gold:'transparent'}`,
                display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <span style={{ fontSize:16 }}>{t.icon}</span>{t.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>

        {/* ROOSTER */}
        {tab === 'rooster' && <>
          <WeekNav week={weekIdx} weeks={weeks.map(w=>w.label)} setWeek={setWeekIdx}/>
          {!isPublished && (
            <div style={{ background:C.amberSoft, border:`1px solid ${C.amber}44`, borderRadius:12,
              padding:'10px 14px', display:'flex', gap:8, alignItems:'center' }}>
              <span>⏳</span>
              <span style={{ color:C.amber, fontSize:13, fontWeight:600 }}>
                {status === 'concept' ? 'Rooster wordt nog gemaakt' : 'Rooster wordt gepubliceerd op de 18e om 23:59'}
              </span>
            </div>
          )}
          {DAYS.map((day, di) => {
            const sh = schedule[di]
            const date = currentWeek.dates[di]
            const lv = leaveRequests.find(l => l.date === date && l.status === 'approved')
            const tmpl = sh && shiftTemplates[sh]

            if (lv) return (
              <Card key={day} style={{ background:C.amberSoft, border:`1px solid ${C.amber}44`, padding:'14px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:700, color:C.ink }}>{DAYS_FULL[di]} <span style={{ color:C.inkMuted, fontSize:11 }}>{formatDate(date)}</span></div>
                    <div style={{ color:C.amber, fontSize:13, fontWeight:600, marginTop:2 }}>🏖 Vrij — {lv.reason}</div>
                  </div>
                  <Badge color={C.amber}>Goedgekeurd</Badge>
                </div>
              </Card>
            )

            if (!sh) return (
              <Card key={day} style={{ padding:'14px 16px', opacity:0.4 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <div style={{ fontWeight:600, color:C.inkMuted }}>{DAYS_FULL[di]} <span style={{ fontSize:11 }}>{formatDate(date)}</span></div>
                  <span style={{ color:C.inkMuted, fontSize:12 }}>Vrij</span>
                </div>
              </Card>
            )

            const dColor = me.depts?.[0] ? DEPTS[me.depts[0]]?.color : C.gold
            const workHours = tmpl ? (parseTime(tmpl.end_time) - parseTime(tmpl.start_time) - tmpl.break_minutes) / 60 : 0

            return (
              <Card key={day} style={{ padding:'14px 16px', borderLeft:`4px solid ${dColor}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ fontWeight:800, color:C.ink, fontSize:15 }}>{DAYS_FULL[di]}</div>
                      <div style={{ color:C.inkMuted, fontSize:11 }}>{formatDate(date)}</div>
                    </div>
                    <div style={{ color:dColor, fontSize:22, fontWeight:900, marginTop:4, letterSpacing:'-0.02em' }}>
                      {tmpl?.start_time} – {tmpl?.end_time}
                    </div>
                    <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
                      <Badge color={dColor}>{sh}</Badge>
                      <Badge color={C.inkMuted}>{workHours.toFixed(0)}u werk</Badge>
                      {tmpl?.break_minutes > 0 && <Badge color={C.inkMuted}>{tmpl.break_minutes}min pauze</Badge>}
                    </div>
                  </div>
                  {isPublished && tmpl && (
                    <a href={buildGCalLink(me.name, date, tmpl)} target="_blank" rel="noreferrer"
                      style={{ ...btn(), background:C.skySoft, color:C.sky, border:`1px solid ${C.sky}33`,
                        padding:'8px 12px', borderRadius:10, fontSize:12, textDecoration:'none',
                        display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                      📅 Agenda
                    </a>
                  )}
                </div>
              </Card>
            )
          })}
          {isPublished && (
            <button onClick={() => {
              schedule.forEach((sh, di) => {
                const tmpl = sh && shiftTemplates[sh]
                if (tmpl) window.open(buildGCalLink(me.name, currentWeek.dates[di], tmpl), '_blank')
              })
              show('✓ Diensten geopend in Google Calendar')
            }} style={{ ...btn(), background:C.sky, color:C.white, padding:'13px', width:'100%', borderRadius:12, fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <span style={{ fontSize:18 }}>📅</span> Exporteer week naar Google Agenda
            </button>
          )}
        </>}

        {/* BESCHIKBAARHEID */}
        {tab === 'beschikbaar' && (
          <AvailabilityEditor
            patterns={availPatterns} overrides={availOverrides}
            onSavePattern={savePattern} onSaveOverride={saveOverride}
            onSaved={() => show('✓ Beschikbaarheid opgeslagen')}
          />
        )}

        {/* VRIJ */}
        {tab === 'vrij' && (
          <LeaveTab
            leaveRequests={leaveRequests} onRequest={requestLeave} show={show}
          />
        )}

        {/* RUILEN */}
        {tab === 'ruilen' && (
          <SwapTab
            swapRequests={swapRequests} allStaff={allStaff}
            schedule={schedule} shiftTemplates={shiftTemplates}
            currentWeek={currentWeek} myId={me.id}
            onRequest={requestSwap} show={show}
          />
        )}
      </div>
    </div>
  )
}

function parseTime(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function buildGCalLink(name, date, tmpl) {
  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const s = new Date(`${date}T${tmpl.start_time}:00`)
  const e = new Date(`${date}T${tmpl.end_time}:00`)
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: `Dienst ${tmpl.name}`,
    dates: `${fmt(s)}/${fmt(e)}`,
    details: `${name} · ${tmpl.start_time}–${tmpl.end_time} · ${((parseTime(tmpl.end_time)-parseTime(tmpl.start_time)-tmpl.break_minutes)/60).toFixed(1)}u`,
    location: 'Restaurant',
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

function AvailabilityEditor({ patterns, overrides, onSavePattern, onSaveOverride, onSaved }) {
  const [mode, setMode] = useState('pattern')
  const [selDate, setSelDate] = useState('')
  const [dateSlots, setDateSlots] = useState(0)
  const SLOTS = ['Ochtend', 'Middag', 'Avond']

  return (
    <Card style={{ padding:20 }}>
      <div style={{ fontWeight:800, fontSize:16, marginBottom:4 }}>Beschikbaarheid</div>
      <div style={{ color:C.inkMuted, fontSize:13, marginBottom:16 }}>Stel je wekelijks patroon in of overschrijf een datum</div>

      <div style={{ display:'flex', gap:6, background:'#EBE7DE', padding:4, borderRadius:12, marginBottom:18 }}>
        {[{ id:'pattern', l:'📆 Wekelijks' }, { id:'date', l:'📅 Specifieke datum' }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            style={{ ...btn(), flex:1, background:mode===m.id?C.surface:'transparent',
              color:mode===m.id?C.ink:C.inkMuted, padding:'9px', fontSize:13, borderRadius:9,
              boxShadow:mode===m.id?'0 1px 4px rgba(0,0,0,.08)':'none' }}>
            {m.l}
          </button>
        ))}
      </div>

      {mode === 'pattern' && <>
        {DAYS.map((day, di) => {
          const bits = patterns[di] ?? 0
          return (
            <div key={day} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:`1px solid #EEE9E0` }}>
              <div style={{ width:76, fontWeight:700, fontSize:13, color:C.ink, flexShrink:0 }}>{DAYS_FULL[di].slice(0,3)}</div>
              <div style={{ display:'flex', gap:5, flex:1 }}>
                {SLOTS.map((sl, si) => {
                  const active = !!(bits & (1 << si))
                  return (
                    <button key={sl} onClick={() => onSavePattern(di, active ? bits & ~(1<<si) : bits | (1<<si))}
                      style={{ ...btn(), flex:1, padding:'7px 4px', fontSize:11, borderRadius:9,
                        background:active?C.jade+'18':'transparent',
                        border:`1.5px solid ${active?C.jade:C.border}`,
                        color:active?C.jade:C.inkMuted, fontWeight:active?700:500 }}>
                      {sl}
                    </button>
                  )
                })}
              </div>
              {!bits && <Badge color={C.crimson}>Vrij</Badge>}
            </div>
          )
        })}
        <button onClick={onSaved}
          style={{ ...btn(), background:C.ink, color:C.white, padding:'12px', width:'100%', fontSize:14, borderRadius:11, marginTop:16 }}>
          Opslaan
        </button>
      </>}

      {mode === 'date' && <>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Datum</div>
          <input type="date" value={selDate} onChange={e => { setSelDate(e.target.value); setDateSlots(0) }}
            style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
        </div>
        {selDate && <>
          <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:8 }}>Beschikbaarheid op {selDate}</div>
          <div style={{ display:'flex', gap:6, marginBottom:10 }}>
            {SLOTS.map((sl, si) => {
              const active = !!(dateSlots & (1 << si))
              return (
                <button key={sl} onClick={() => setDateSlots(d => d ^ (1 << si))}
                  style={{ ...btn(), flex:1, padding:'9px', fontSize:12, borderRadius:10,
                    background:active?C.jade+'18':'transparent',
                    border:`1.5px solid ${active?C.jade:C.border}`,
                    color:active?C.jade:C.inkMuted, fontWeight:active?700:500 }}>
                  {sl}
                </button>
              )
            })}
          </div>
          <button onClick={() => setDateSlots(0)}
            style={{ ...btn(), width:'100%', background:C.crimsonSoft, color:C.crimson,
              border:`1px solid ${C.crimson}33`, padding:'8px', fontSize:12, borderRadius:9, marginBottom:10 }}>
            Hele dag onbeschikbaar
          </button>
          <button onClick={() => { onSaveOverride(selDate, dateSlots); setSelDate(''); onSaved() }}
            style={{ ...btn(), width:'100%', background:C.ink, color:C.white, padding:'11px', fontSize:13, borderRadius:10 }}>
            Opslaan
          </button>
        </>}

        {Object.entries(overrides).length > 0 && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:8 }}>Bestaande uitzonderingen</div>
            {Object.entries(overrides).sort().map(([date, bits]) => (
              <div key={date} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'9px 12px', background:'#EBE7DE', borderRadius:10, marginBottom:6 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:13 }}>{date}</div>
                  <div style={{ color:C.inkMuted, fontSize:11 }}>
                    {bits === 0 ? 'Onbeschikbaar' : ['Ochtend','Middag','Avond'].filter((_,si) => bits & (1<<si)).join(', ')}
                  </div>
                </div>
                <button onClick={() => onSaveOverride(date, undefined)}
                  style={{ ...btn(), background:C.crimsonSoft, color:C.crimson, padding:'5px 10px', fontSize:11, borderRadius:8 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </>}
    </Card>
  )
}

function LeaveTab({ leaveRequests, onRequest, show }) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ date:'', reason:'' })

  return <>
    <button onClick={() => setModal(true)}
      style={{ ...btn(), background:C.terra, color:C.white, padding:'14px', fontSize:15, borderRadius:14,
        display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
      ＋ Vrije dag aanvragen
    </button>
    {leaveRequests.length === 0
      ? <Card style={{ textAlign:'center', padding:40 }}><div style={{ fontSize:36, marginBottom:8 }}>🏖</div><div style={{ color:C.inkMuted }}>Nog geen vrije dagen aangevraagd</div></Card>
      : leaveRequests.map(l => (
        <Card key={l.id} style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontWeight:700, color:C.ink }}>{l.date}</div>
              <div style={{ color:C.inkMuted, fontSize:13, marginTop:2 }}>{l.reason}</div>
            </div>
            <Badge color={l.status==='approved'?C.jade:l.status==='pending'?C.amber:C.crimson}>
              {l.status==='approved'?'✓ Goedgekeurd':l.status==='pending'?'⏳ Wacht':'✗ Afgewezen'}
            </Badge>
          </div>
        </Card>
      ))
    }
    {modal && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'flex-end', justifyContent:'center', zIndex:999 }} onClick={() => setModal(false)}>
        <div style={{ background:C.surface, borderRadius:'20px 20px 0 0', padding:24, width:'100%', maxWidth:500 }} onClick={e=>e.stopPropagation()}>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:18 }}>Vrije dag aanvragen</div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Datum</div>
            <input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Reden</div>
            <input value={form.reason} onChange={e => setForm(f=>({...f,reason:e.target.value}))} placeholder="Bijv. vakantie..."
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setModal(false)} style={{ ...btn(), flex:1, background:'#EBE7DE', color:C.inkMid, padding:'13px', borderRadius:12 }}>Annuleren</button>
            <button onClick={() => { if (!form.date) return; onRequest(form.date, form.reason); setModal(false); show('✓ Aanvraag verzonden') }}
              style={{ ...btn(), flex:2, background:C.ink, color:C.white, padding:'13px', borderRadius:12 }}>Aanvragen</button>
          </div>
        </div>
      </div>
    )}
  </>
}

function SwapTab({ swapRequests, allStaff, schedule, shiftTemplates, currentWeek, myId, onRequest, show }) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ myDay:0, withId:'', theirDay:0 })

  return <>
    <button onClick={() => setModal(true)}
      style={{ ...btn(), background:C.ink, color:C.white, padding:'14px', fontSize:15, borderRadius:14,
        display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
      🔄 Dienst ruilen
    </button>
    {swapRequests.length === 0
      ? <Card style={{ textAlign:'center', padding:40 }}><div style={{ fontSize:36, marginBottom:8 }}>🔄</div><div style={{ color:C.inkMuted }}>Nog geen ruilverzoeken</div></Card>
      : swapRequests.map(sw => {
        const isFrom = sw.from_staff_id === myId
        const other = isFrom ? sw.to_staff : sw.from_staff
        return (
          <Card key={sw.id} style={{ padding:'14px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13, color:C.ink }}>
                  {isFrom ? sw.from_date : sw.to_date} ↔ {other?.name?.split(' ')[0]} ({isFrom ? sw.to_date : sw.from_date})
                </div>
                <div style={{ color:C.inkMuted, fontSize:12, marginTop:2 }}>{isFrom?'Jouw verzoek':'Inkomend verzoek'}</div>
              </div>
              <Badge color={sw.status==='approved'?C.jade:C.amber}>{sw.status==='approved'?'✓ Geruild':'⏳ Wacht'}</Badge>
            </div>
          </Card>
        )
      })
    }
    {modal && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'flex-end', justifyContent:'center', zIndex:999 }} onClick={() => setModal(false)}>
        <div style={{ background:C.surface, borderRadius:'20px 20px 0 0', padding:24, width:'100%', maxWidth:500 }} onClick={e=>e.stopPropagation()}>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:18 }}>Dienst ruilen</div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Mijn dienst op</div>
            <select value={form.myDay} onChange={e => setForm(f=>({...f,myDay:+e.target.value}))}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, color:C.ink }}>
              {DAYS_FULL.map((d, i) => {
                const sh = schedule[i]; const t = sh && shiftTemplates[sh]
                return <option key={i} value={i}>{d} {t?`— ${t.start_time}–${t.end_time}`:'(vrij)'}</option>
              })}
            </select>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Ruilen met</div>
            <select value={form.withId} onChange={e => setForm(f=>({...f,withId:e.target.value}))}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, color:C.ink }}>
              <option value="">Kies collega</option>
              {allStaff.filter(s => s.id !== myId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Hun dienst op</div>
            <select value={form.theirDay} onChange={e => setForm(f=>({...f,theirDay:+e.target.value}))}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, color:C.ink }}>
              {DAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setModal(false)} style={{ ...btn(), flex:1, background:'#EBE7DE', color:C.inkMid, padding:'13px', borderRadius:12 }}>Annuleren</button>
            <button onClick={() => {
              if (!form.withId) return
              onRequest(currentWeek.dates[form.myDay], form.withId, currentWeek.dates[form.theirDay])
              setModal(false)
            }} style={{ ...btn(), flex:2, background:C.terra, color:C.white, padding:'13px', borderRadius:12 }}>Sturen</button>
          </div>
        </div>
      </div>
    )}
  </>
}
