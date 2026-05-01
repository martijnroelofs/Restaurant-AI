import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { generateSchedule, calcFinancials } from '../lib/scheduler'
import {
  C, DEPTS, CONTRACT_TYPES, Badge, Card, Avatar, Toast, WeekNav,
  Input, Select, btn, getWeekDates, getMondayOfWeek, formatDate,
  DAYS, DAYS_FULL,
} from '../components/ui'

const DEPT_KEYS = Object.keys(DEPTS)

function getWeeks() {
  const weeks = []
  const now = new Date()
  const start = new Date(getMondayOfWeek(new Date(now.getFullYear(), now.getMonth() - 1, 1)))
  for (let i = 0; i < 16; i++) {
    const mon = new Date(start)
    mon.setDate(start.getDate() + i * 7)
    const monStr = mon.toISOString().split('T')[0]
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    const label = `${formatDate(monStr)} – ${formatDate(sun.toISOString().split('T')[0])}`
    weeks.push({ monday: monStr, label, dates: getWeekDates(monStr) })
  }
  return weeks
}

export default function AdminApp() {
  const { staff: me, signOut } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [weekIdx, setWeekIdx] = useState(4) // default = current week
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(true)

  // Data state
  const [allStaff, setAllStaff] = useState([])
  const [shiftTemplates, setShiftTemplates] = useState({})
  const [templateSlots, setTemplateSlots] = useState([])
  const [peakMoments, setPeakMoments] = useState([])
  const [holidays, setHolidays] = useState([])
  const [rosters, setRosters] = useState({}) // { weekMonday: roster }
  const [assignments, setAssignments] = useState({}) // { weekMonday: { staffId: [shift×7] } }
  const [leaveRequests, setLeaveRequests] = useState([])
  const [swapRequests, setSwapRequests] = useState([])
  const [availPatterns, setAvailPatterns] = useState({})
  const [availOverrides, setAvailOverrides] = useState({})
  const [capacities, setCapacities] = useState({})
  const [overtimeLog, setOvertimeLog] = useState({})
  const [settings, setSettings] = useState({})
  const [generating, setGenerating] = useState(false)

  const weeks = useMemo(() => getWeeks(), [])
  const currentWeek = weeks[weekIdx]
  const orgId = me?.org_id

  const show = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    loadAll()

    // Realtime subscription
    const sub = supabase.channel(`admin_${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_assignments' }, loadAssignments)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, loadLeaves)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swap_requests' }, loadSwaps)
      .subscribe()

    return () => supabase.removeChannel(sub)
  }, [orgId])

  async function loadAll() {
    setLoading(true)
    await Promise.all([
      loadStaff(), loadShifts(), loadTemplateSlots(),
      loadPeaks(), loadHolidays(), loadAssignments(),
      loadLeaves(), loadSwaps(), loadAvailability(),
      loadCapacities(), loadSettings(), loadOvertime(),
    ])
    setLoading(false)
  }

  async function loadStaff() {
    const { data } = await supabase.from('staff').select('*').eq('org_id', orgId).eq('is_active', true)
    setAllStaff(data || [])
  }
  async function loadShifts() {
    const { data } = await supabase.from('shift_templates').select('*').eq('org_id', orgId)
    const map = {}
    ;(data || []).forEach(s => { map[s.name] = s })
    setShiftTemplates(map)
  }
  async function loadTemplateSlots() {
    const { data } = await supabase.from('template_slots').select('*').eq('org_id', orgId)
    setTemplateSlots(data || [])
  }
  async function loadPeaks() {
    const { data } = await supabase.from('peak_moments').select('*').eq('org_id', orgId)
    setPeakMoments(data || [])
  }
  async function loadHolidays() {
    const { data } = await supabase.from('public_holidays').select('*, holiday_slots(*)').eq('org_id', orgId)
    setHolidays(data || [])
  }
  async function loadAssignments() {
    const { data: ros } = await supabase.from('rosters').select('*').eq('org_id', orgId)
    const rMap = {}
    ;(ros || []).forEach(r => { rMap[r.week_start] = r })
    setRosters(rMap)

    if (!ros?.length) return
    const rIds = ros.map(r => r.id)
    const { data: asgn } = await supabase.from('roster_assignments').select('*').in('roster_id', rIds)

    const byWeek = {}
    ;(asgn || []).forEach(a => {
      const roster = ros.find(r => r.id === a.roster_id)
      if (!roster) return
      const wk = roster.week_start
      if (!byWeek[wk]) byWeek[wk] = {}
      if (!byWeek[wk][a.staff_id]) byWeek[wk][a.staff_id] = Array(7).fill(null)
      const di = getWeekDates(wk).indexOf(a.date)
      if (di >= 0) byWeek[wk][a.staff_id][di] = a.shift_name
    })
    setAssignments(byWeek)
  }
  async function loadLeaves() {
    const { data } = await supabase.from('leave_requests')
      .select('*, staff(name,color)')
      .in('staff_id', allStaff.map(s => s.id))
    setLeaveRequests(data || [])
  }
  async function loadSwaps() {
    const { data } = await supabase.from('swap_requests')
      .select('*, from_staff:staff!from_staff_id(name,color), to_staff:staff!to_staff_id(name,color)')
      .in('from_staff_id', allStaff.length ? allStaff.map(s => s.id) : ['none'])
    setSwapRequests(data || [])
  }
  async function loadAvailability() {
    const { data: pats } = await supabase.from('availability_patterns')
      .select('*').in('staff_id', allStaff.length ? allStaff.map(s => s.id) : ['none'])
    const { data: ovs } = await supabase.from('availability_overrides')
      .select('*').in('staff_id', allStaff.length ? allStaff.map(s => s.id) : ['none'])
    const patMap = {}
    ;(pats || []).forEach(p => {
      if (!patMap[p.staff_id]) patMap[p.staff_id] = {}
      patMap[p.staff_id][p.day_of_week] = p.slots
    })
    const ovMap = {}
    ;(ovs || []).forEach(o => {
      if (!ovMap[o.staff_id]) ovMap[o.staff_id] = {}
      ovMap[o.staff_id][o.date] = o.slots
    })
    setAvailPatterns(patMap)
    setAvailOverrides(ovMap)
  }
  async function loadCapacities() {
    const { data } = await supabase.from('capacity_scores')
      .select('*').in('staff_id', allStaff.length ? allStaff.map(s => s.id) : ['none'])
    const map = {}
    ;(data || []).forEach(c => {
      if (!map[c.staff_id]) map[c.staff_id] = {}
      map[c.staff_id][c.dept] = c.score
    })
    setCapacities(map)
  }
  async function loadSettings() {
    const { data } = await supabase.from('org_settings').select('*').eq('org_id', orgId).single()
    setSettings(data || {})
  }
  async function loadOvertime() {
    const { data } = await supabase.from('overtime_log').select('*')
      .in('staff_id', allStaff.length ? allStaff.map(s => s.id) : ['none'])
    const map = {}
    ;(data || []).forEach(o => { map[o.staff_id] = (map[o.staff_id] || 0) + (o.overtime_hours - o.compensated_hours) })
    setOvertimeLog(map)
  }

  // ── Generate schedule ────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true)
    try {
      const result = generateSchedule({
        staff: allStaff,
        shiftTemplates,
        templateSlots,
        peakMoments,
        holidays,
        availabilityPatterns: availPatterns,
        availabilityOverrides: availOverrides,
        leaveRequests,
        capacityScores: capacities,
        weekDates: currentWeek.dates,
        settings,
        otHistory: overtimeLog,
      })

      // Upsert roster
      const { data: roster } = await supabase.from('rosters').upsert({
        org_id: orgId, week_start: currentWeek.monday, status: 'concept',
      }, { onConflict: 'org_id,week_start' }).select().single()

      // Delete old assignments for this week
      await supabase.from('roster_assignments').delete().eq('roster_id', roster.id)

      // Insert new assignments
      const toInsert = []
      Object.entries(result.schedule).forEach(([staffId, shifts]) => {
        shifts.forEach((shiftName, di) => {
          if (!shiftName) return
          toInsert.push({
            roster_id: roster.id, staff_id: staffId,
            date: currentWeek.dates[di], shift_name: shiftName,
          })
        })
      })
      if (toInsert.length) await supabase.from('roster_assignments').insert(toInsert)

      // Save overtime log
      const otInserts = Object.entries(result.weekOT).map(([staffId, ot]) => {
        const s = allStaff.find(x => x.id === staffId)
        return {
          staff_id: staffId, roster_id: roster.id,
          hours_worked: result.hoursPlanned[staffId] || 0,
          hours_contract: s?.contract_hours || 20,
          overtime_hours: Math.max(0, ot),
          compensated_hours: 0,
        }
      })
      if (otInserts.length) {
        await supabase.from('overtime_log').upsert(otInserts, { onConflict: 'staff_id,roster_id' })
      }

      await loadAssignments()
      show('🪄 Rooster gegenereerd en opgeslagen!')
    } catch (e) {
      show('Fout: ' + e.message)
    }
    setGenerating(false)
  }

  // ── Publish roster ──────────────────────────────────────────────────────
  async function handlePublish() {
    const roster = rosters[currentWeek.monday]
    if (!roster) { show('Geen rooster om te publiceren'); return }
    await supabase.from('rosters').update({
      status: 'published', published_at: new Date().toISOString()
    }).eq('id', roster.id)
    await loadAssignments()
    show('✓ Rooster gepubliceerd — personeel ontvangt een melding')
    // Send push notifications
    sendPublishNotifications()
  }

  async function sendPublishNotifications() {
    const { data: subs } = await supabase.from('push_subscriptions')
      .select('*').in('staff_id', allStaff.map(s => s.id))
    if (!subs?.length) return
    // In production: call a Supabase Edge Function to send push messages
    // supabase.functions.invoke('send-push', { body: { subscriptions: subs, ... } })
    console.log(`Would send push to ${subs.length} devices`)
  }

  // ── Approve/reject helpers ───────────────────────────────────────────────
  async function reviewLeave(id, status) {
    await supabase.from('leave_requests').update({
      status, reviewed_by: me.id, reviewed_at: new Date().toISOString()
    }).eq('id', id)
    await loadLeaves()
    show(status === 'approved' ? '✓ Vrije dag goedgekeurd' : 'Aanvraag afgewezen')
  }

  async function reviewSwap(id, status) {
    await supabase.from('swap_requests').update({
      status, reviewed_by: me.id, reviewed_at: new Date().toISOString()
    }).eq('id', id)
    await loadSwaps()
    show(status === 'approved' ? '✓ Ruiling goedgekeurd' : 'Ruiling afgewezen')
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const currentSchedule = assignments[currentWeek.monday] || {}
  const currentRoster = rosters[currentWeek.monday]
  const isPublished = currentRoster?.status === 'published'
  const pendingLeaves = leaveRequests.filter(l => l.status === 'pending')
  const pendingSwaps = swapRequests.filter(s => s.status === 'pending')
  const notifications = pendingLeaves.length + pendingSwaps.length

  const fin = useMemo(() => calcFinancials(
    allStaff, currentSchedule, shiftTemplates, currentWeek.dates, holidays
  ), [allStaff, currentSchedule, shiftTemplates, currentWeek.dates, holidays])

  const tabs = [
    { id:'dashboard', icon:'📊', l:'Dashboard' },
    { id:'rooster',   icon:'📅', l:'Rooster' },
    { id:'historisch',icon:'🗂',  l:'Historisch' },
    { id:'template',  icon:'🗓',  l:'Template' },
    { id:'aanvragen', icon:'🔔',  l:'Aanvragen', badge: notifications },
    { id:'personeel', icon:'👥',  l:'Personeel' },
    { id:'financieel',icon:'💶',  l:'Financieel' },
    { id:'instellingen',icon:'⚙️',l:'Instellingen' },
  ]

  if (loading) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}><div style={{ fontSize:40, marginBottom:12 }}>🍽</div><div style={{ color:C.inkMuted }}>Laden...</div></div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      {toast && <Toast msg={toast} />}

      {/* Nav */}
      <div style={{ background:C.ink, padding:'0 16px', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:C.gold, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🍽</div>
            <div>
              <div style={{ color:C.white, fontWeight:900, fontSize:15 }}>RoosterAI</div>
              <div style={{ color:'rgba(255,255,255,0.3)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase' }}>Manager</div>
            </div>
          </div>
          <button onClick={signOut} style={{ ...btn(), background:'rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.4)', padding:'6px 14px', fontSize:12, borderRadius:8 }}>
            Uitloggen
          </button>
        </div>
        <div style={{ display:'flex', marginTop:10, overflowX:'auto', scrollbarWidth:'none' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...btn(), flex:'0 0 auto', minWidth:56, background:'transparent', borderRadius:0,
                color:tab===t.id?C.white:'rgba(255,255,255,0.32)', padding:'9px 6px 13px',
                fontSize:9, fontWeight:700, borderBottom:`3px solid ${tab===t.id?C.gold:'transparent'}`,
                display:'flex', flexDirection:'column', alignItems:'center', gap:2, position:'relative' }}>
              <span style={{ fontSize:15 }}>{t.icon}</span>{t.l}
              {t.badge > 0 && <span style={{ position:'absolute', top:5, right:'calc(50% - 18px)',
                background:C.terra, color:C.white, borderRadius:99, fontSize:9, fontWeight:800, padding:'1px 5px' }}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:16, maxWidth:1200, margin:'0 auto' }}>

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
              <div>
                <div style={{ fontWeight:900, fontSize:22, color:C.ink }}>Dashboard</div>
                <div style={{ color:C.inkMuted, fontSize:13 }}>{currentWeek.label}</div>
              </div>
              <WeekNav week={weekIdx} weeks={weeks.map(w=>w.label)} setWeek={setWeekIdx} />
            </div>

            {/* KPIs */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
              {[
                { l:'Diensten', v:Object.values(currentSchedule).flat().filter(Boolean).length, icon:'📅', c:C.sky },
                { l:'Medewerkers', v:allStaff.length, icon:'👥', c:C.purple },
                { l:'Loonkosten', v:`€${fin.totalCost.toFixed(0)}`, icon:'💶', c:C.terra },
                { l:'Aanvragen', v:notifications, icon:'🔔', c:notifications>0?C.terra:C.jade },
                { l:'Status', v:isPublished?'Gepubliceerd':'Concept', icon:'📋', c:isPublished?C.jade:C.amber },
              ].map(s => (
                <Card key={s.l} style={{ padding:'14px 16px' }}>
                  <div style={{ fontSize:20, marginBottom:6 }}>{s.icon}</div>
                  <div style={{ color:s.c, fontSize:18, fontWeight:900 }}>{s.v}</div>
                  <div style={{ color:C.inkMuted, fontSize:11, marginTop:2 }}>{s.l}</div>
                </Card>
              ))}
            </div>

            {/* Publish status */}
            <div style={{ background:isPublished?C.jadeSoft:C.amberSoft,
              border:`1px solid ${isPublished?C.jade:C.amber}44`,
              borderRadius:14, padding:'12px 18px', display:'flex',
              alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:10, height:10, borderRadius:99,
                  background:isPublished?C.jade:C.amber }}/>
                <div>
                  <div style={{ fontWeight:800, color:isPublished?C.jade:C.amber, fontSize:14 }}>
                    {isPublished ? '✓ Gepubliceerd' : 'Concept — niet zichtbaar voor personeel'}
                  </div>
                  <div style={{ color:C.inkMuted, fontSize:12 }}>
                    {isPublished ? `Gepubliceerd op ${new Date(currentRoster?.published_at).toLocaleDateString('nl-NL')}`
                      : 'Genereer en publiceer het rooster voor dit week'}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleGenerate} disabled={generating}
                  style={{ ...btn(), background:generating?C.inkMuted:C.terra, color:C.white,
                    padding:'8px 16px', fontSize:13, borderRadius:10 }}>
                  {generating ? '⟳ Bezig...' : '🪄 Genereer'}
                </button>
                {!isPublished && currentRoster && (
                  <button onClick={handlePublish}
                    style={{ ...btn(), background:C.jade, color:C.white, padding:'8px 16px', fontSize:13, borderRadius:10 }}>
                    Publiceren
                  </button>
                )}
              </div>
            </div>

            {/* Bezetting per dag */}
            <Card style={{ padding:20 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.inkMid, marginBottom:14 }}>BEZETTING PER DAG</div>
              <div style={{ display:'flex', gap:6 }}>
                {DAYS.map((d, di) => {
                  const n = allStaff.filter(s => currentSchedule[s.id]?.[di]).length
                  const peak = peakMoments.find(p => p.date === currentWeek.dates[di])
                  return (
                    <div key={d} style={{ flex:1, textAlign:'center' }}>
                      <div style={{ background:peak?C.crimsonSoft:C.jadeSoft,
                        border:`1px solid ${peak?C.crimson:C.jade}44`,
                        borderRadius:10, padding:'10px 4px' }}>
                        <div style={{ fontWeight:900, fontSize:18, color:peak?C.crimson:C.jade }}>{n}</div>
                        <div style={{ color:C.inkMuted, fontSize:9 }}>pers.</div>
                      </div>
                      <div style={{ color:peak?C.crimson:C.inkMuted, fontSize:10, marginTop:4, fontWeight:700 }}>
                        {d}{peak?' 🔥':''}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        )}

        {/* ── ROOSTER ── */}
        {tab === 'rooster' && (
          <RoosterTab
            allStaff={allStaff} currentSchedule={currentSchedule}
            currentWeek={currentWeek} shiftTemplates={shiftTemplates}
            peakMoments={peakMoments} leaveRequests={leaveRequests}
            availPatterns={availPatterns} availOverrides={availOverrides}
            capacities={capacities} isPublished={isPublished}
            weekIdx={weekIdx} weeks={weeks} setWeekIdx={setWeekIdx}
            onGenerate={handleGenerate} generating={generating}
            onPublish={handlePublish}
            onCellChange={async (staffId, di, shiftName) => {
              const roster = currentRoster || (await supabase.from('rosters').upsert({
                org_id: orgId, week_start: currentWeek.monday, status:'concept'
              }, { onConflict:'org_id,week_start' }).select().single()).data
              if (shiftName) {
                await supabase.from('roster_assignments').upsert({
                  roster_id: roster.id, staff_id: staffId,
                  date: currentWeek.dates[di], shift_name: shiftName,
                }, { onConflict:'roster_id,staff_id,date' })
              } else {
                await supabase.from('roster_assignments').delete()
                  .eq('roster_id', roster.id).eq('staff_id', staffId).eq('date', currentWeek.dates[di])
              }
              await loadAssignments()
              show('✓ Dienst bijgewerkt')
            }}
          />
        )}

        {/* ── HISTORISCH ── */}
        {tab === 'historisch' && (
          <HistorischTab
            weeks={weeks} rosters={rosters} assignments={assignments}
            allStaff={allStaff} shiftTemplates={shiftTemplates}
            weekIdx={weekIdx} setWeekIdx={setWeekIdx}
          />
        )}

        {/* ── TEMPLATE ── */}
        {tab === 'template' && (
          <TemplateTab
            templateSlots={templateSlots} shiftTemplates={shiftTemplates}
            peakMoments={peakMoments} holidays={holidays}
            orgId={orgId} onReload={loadAll} show={show}
          />
        )}

        {/* ── AANVRAGEN ── */}
        {tab === 'aanvragen' && (
          <AanvragenTab
            pendingLeaves={pendingLeaves} pendingSwaps={pendingSwaps}
            onLeave={reviewLeave} onSwap={reviewSwap}
          />
        )}

        {/* ── PERSONEEL ── */}
        {tab === 'personeel' && (
          <PersoneelTab
            allStaff={allStaff} capacities={capacities}
            orgId={orgId} onReload={loadAll} show={show}
            shiftTemplates={shiftTemplates}
            currentSchedule={currentSchedule}
            overtimeLog={overtimeLog}
          />
        )}

        {/* ── FINANCIEEL ── */}
        {tab === 'financieel' && (
          <FinancieelTab
            fin={fin} allStaff={allStaff}
            currentSchedule={currentSchedule}
            shiftTemplates={shiftTemplates}
            currentWeek={currentWeek}
            weekIdx={weekIdx} weeks={weeks} setWeekIdx={setWeekIdx}
            DAYS={DAYS}
          />
        )}

        {/* ── INSTELLINGEN ── */}
        {tab === 'instellingen' && (
          <InstellingenTab
            settings={settings} orgId={orgId}
            shiftTemplates={shiftTemplates}
            onReload={loadAll} show={show}
          />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoosterTab({ allStaff, currentSchedule, currentWeek, shiftTemplates, peakMoments,
  leaveRequests, availPatterns, availOverrides, capacities, isPublished,
  weekIdx, weeks, setWeekIdx, onGenerate, generating, onPublish, onCellChange }) {
  const [editCell, setEditCell] = useState(null)

  const staffByDept = useMemo(() => {
    const o = {}
    DEPT_KEYS.forEach(dk => { o[dk] = allStaff.filter(s => s.depts?.includes(dk)) })
    return o
  }, [allStaff])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {editCell && <div style={{ position:'fixed', inset:0, zIndex:8 }} onClick={() => setEditCell(null)}/>}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <WeekNav week={weekIdx} weeks={weeks.map(w=>w.label)} setWeek={setWeekIdx} />
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={onGenerate} disabled={generating || isPublished}
            style={{ ...btn(), background:isPublished?C.inkMuted:C.terra, color:C.white,
              padding:'10px 18px', fontSize:13, borderRadius:11, opacity:isPublished?0.5:1 }}>
            {generating ? '⟳ Bezig...' : '🪄 Genereer'}
          </button>
          {!isPublished && (
            <button onClick={onPublish}
              style={{ ...btn(), background:C.jade, color:C.white, padding:'10px 18px', fontSize:13, borderRadius:11 }}>
              Publiceren
            </button>
          )}
        </div>
      </div>

      {/* Day indicator row */}
      <div style={{ display:'flex', gap:5 }}>
        {DAYS.map((d, di) => {
          const peak = peakMoments.find(p => p.date === currentWeek.dates[di])
          return (
            <div key={d} style={{ flex:1, textAlign:'center', padding:'5px 3px', borderRadius:8,
              background:peak?C.crimsonSoft:'transparent',
              border:`1px solid ${peak?C.crimson+'44':'#EEE9E0'}` }}>
              <div style={{ fontWeight:700, fontSize:11, color:peak?C.crimson:C.inkMuted }}>{d}</div>
              {peak && <div style={{ fontSize:8, color:C.crimson }}>🔥</div>}
            </div>
          )
        })}
      </div>

      {/* Roster by department */}
      {DEPT_KEYS.map(dk => {
        const dept = DEPTS[dk]
        const ds = staffByDept[dk]
        if (!ds.length) return null
        const dayCount = DAYS.map((_, di) => ds.filter(s => currentSchedule[s.id]?.[di]).length)

        return (
          <div key={dk}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              background:dept.color+'12', border:`1px solid ${dept.color}33`,
              borderRadius:12, marginBottom:6 }}>
              <span style={{ fontSize:18 }}>{dept.icon}</span>
              <span style={{ fontWeight:800, color:dept.color, fontSize:14 }}>{dept.label}</span>
              <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
                {dayCount.map((n, i) => {
                  const peak = peakMoments.find(p => p.date === currentWeek.dates[i])
                  const need = dept.min + (peak ? 1 : 0)
                  return (
                    <div key={i} style={{ width:28, textAlign:'center' }}>
                      <div style={{ fontWeight:800, fontSize:12, color:n>=need?dept.color:C.crimson }}>{n}</div>
                      <div style={{ fontSize:8, color:C.inkMuted }}>{DAYS[i]}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <Card style={{ padding:12, overflowX:'auto', marginBottom:4 }}>
              <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:'0 3px', minWidth:600 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', color:C.inkMuted, fontSize:11, fontWeight:700, padding:'0 8px 8px 0', minWidth:130 }}>Medewerker</th>
                    {DAYS_FULL.map((d, i) => (
                      <th key={d} style={{ color:C.inkMuted, fontSize:10, fontWeight:700, padding:'0 3px 8px', textAlign:'center', minWidth:90 }}>
                        {DAYS[i]}<br/><span style={{ fontSize:9, fontWeight:400 }}>{formatDate(currentWeek.dates[i])}</span>
                      </th>
                    ))}
                    <th style={{ color:C.inkMuted, fontSize:10, padding:'0 0 8px 8px', textAlign:'right', minWidth:60 }}>Uren</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.map(s => {
                    const row = currentSchedule[s.id] || Array(7).fill(null)
                    const hours = row.reduce((a, sh) => a + (sh && shiftTemplates[sh] ? (parseTime(shiftTemplates[sh].end_time) - parseTime(shiftTemplates[sh].start_time) - shiftTemplates[sh].break_minutes) / 60 : 0), 0)
                    const over = hours > (s.contract_hours || 20)
                    const cap = capacities[s.id]?.[dk] ?? 5

                    return (
                      <tr key={s.id}>
                        <td style={{ padding:'3px 8px 3px 0' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                            <Avatar name={s.name} color={s.color} size={28}/>
                            <div>
                              <div style={{ fontWeight:700, fontSize:12, color:C.ink }}>{s.name.split(' ')[0]}</div>
                              <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                                <div style={{ width:24, height:4, background:'#EBE7DE', borderRadius:99, overflow:'hidden' }}>
                                  <div style={{ height:'100%', width:`${cap*10}%`, background:cap>=8?C.jade:cap>=5?dept.color:C.crimson, borderRadius:99 }}/>
                                </div>
                                <span style={{ color:C.inkMuted, fontSize:9 }}>{cap}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        {row.map((sh, di) => {
                          const lv = leaveRequests.find(l => l.staff_id===s.id && l.date===currentWeek.dates[di] && l.status==='approved')
                          const isEd = editCell?.sid===s.id && editCell?.day===di
                          const shift = sh && shiftTemplates[sh]

                          let cell
                          if (lv) cell = (
                            <div style={{ background:C.amberSoft, border:`1px solid ${C.amber}44`, borderRadius:7, padding:'5px 3px', textAlign:'center' }}>
                              <div style={{ fontSize:9 }}>🏖</div>
                              <div style={{ color:C.amber, fontSize:8, fontWeight:700 }}>Vrij</div>
                            </div>
                          )
                          else if (isEd) cell = (
                            <div style={{ position:'relative', zIndex:10 }}>
                              <div style={{ position:'absolute', top:'100%', left:0, background:C.surface,
                                border:`1px solid ${C.border}`, borderRadius:10, padding:6,
                                boxShadow:'0 8px 30px rgba(0,0,0,.12)', zIndex:20, minWidth:150 }}>
                                <div onClick={() => { onCellChange(s.id, di, null); setEditCell(null) }}
                                  style={{ padding:'6px 10px', borderRadius:7, cursor:'pointer', color:C.inkMuted, fontSize:12, fontWeight:600 }}>— Vrij</div>
                                {Object.keys(shiftTemplates).map(n => {
                                  const t = shiftTemplates[n]
                                  return (
                                    <div key={n} onClick={() => { onCellChange(s.id, di, n); setEditCell(null) }}
                                      style={{ padding:'6px 10px', borderRadius:7, cursor:'pointer',
                                        color:dept.color, fontSize:12, fontWeight:700,
                                        background:sh===n?dept.color+'18':'transparent',
                                        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                      <span>{n}</span>
                                      <span style={{ color:C.inkMuted, fontSize:10 }}>{t.start_time}–{t.end_time}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                          else if (sh && shift) cell = (
                            <div onClick={() => !isPublished && setEditCell({ sid:s.id, day:di })}
                              style={{ background:dept.color+'18', border:`1.5px solid ${dept.color}55`,
                                borderRadius:7, padding:'4px 3px', textAlign:'center',
                                cursor:isPublished?'default':'pointer' }}>
                              <div style={{ color:dept.color, fontSize:10, fontWeight:800 }}>{sh}</div>
                              <div style={{ color:dept.color+'AA', fontSize:8, fontWeight:600 }}>{shift.start_time}–{shift.end_time}</div>
                            </div>
                          )
                          else cell = (
                            <div onClick={() => !isPublished && setEditCell({ sid:s.id, day:di })}
                              style={{ border:`1.5px dashed ${C.border}`, borderRadius:7, padding:'8px 3px',
                                textAlign:'center', opacity:0.4, cursor:isPublished?'default':'pointer' }}>
                              <div style={{ color:C.inkMuted, fontSize:10 }}>＋</div>
                            </div>
                          )

                          return <td key={di} style={{ padding:'0 3px', position:'relative' }}>{cell}</td>
                        })}
                        <td style={{ textAlign:'right', paddingLeft:6 }}>
                          <span style={{ color:over?C.crimson:C.jade, fontWeight:800, fontSize:12 }}>{hours.toFixed(0)}u</span>
                          <div style={{ color:C.inkMuted, fontSize:9 }}>/{s.contract_hours || 20}u</div>
                          {over && <div style={{ color:C.crimson, fontSize:8 }}>OT</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )
      })}
      {!isPublished && <div style={{ color:C.inkMuted, fontSize:11, textAlign:'center' }}>💡 Klik op een cel om een dienst aan te passen</div>}
    </div>
  )
}

function parseTime(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function HistorischTab({ weeks, rosters, assignments, allStaff, shiftTemplates, weekIdx, setWeekIdx }) {
  const publishedWeeks = weeks.filter(w => rosters[w.monday]?.status === 'published')

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ fontWeight:900, fontSize:20, color:C.ink }}>Historisch overzicht</div>
      {publishedWeeks.length === 0 && (
        <Card style={{ textAlign:'center', padding:48 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🗂</div>
          <div style={{ color:C.inkMuted }}>Nog geen gepubliceerde roosters</div>
        </Card>
      )}
      {publishedWeeks.map(w => {
        const sched = assignments[w.monday] || {}
        const totalShifts = Object.values(sched).flat().filter(Boolean).length
        const roster = rosters[w.monday]
        return (
          <Card key={w.monday} onClick={() => setWeekIdx(weeks.findIndex(x => x.monday === w.monday))}
            style={{ padding:'14px 16px', cursor:'pointer' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:C.ink }}>{w.label}</div>
                <div style={{ color:C.inkMuted, fontSize:12, marginTop:2 }}>
                  {totalShifts} diensten · Gepubliceerd {new Date(roster.published_at).toLocaleDateString('nl-NL')}
                </div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Badge color={C.jade}>✓ Gepubliceerd</Badge>
                <Badge color={C.inkMuted}>{totalShifts} diensten</Badge>
              </div>
            </div>
            <div style={{ display:'flex', gap:3, marginTop:10 }}>
              {DAYS.map((d, di) => {
                const n = allStaff.filter(s => sched[s.id]?.[di]).length
                return (
                  <div key={d} style={{ flex:1, textAlign:'center' }}>
                    <div style={{ height:20, borderRadius:4, background:n>0?C.sky:C.surfaceAlt, opacity:n>0?1:0.3 }}/>
                    <div style={{ fontSize:8, color:C.inkMuted, marginTop:2 }}>{d}</div>
                    <div style={{ fontSize:8, fontWeight:700, color:C.sky }}>{n||''}</div>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function TemplateTab({ templateSlots, shiftTemplates, peakMoments, holidays, orgId, onReload, show }) {
  const [dayTab, setDayTab] = useState(0)
  const [newPeak, setNewPeak] = useState({ date:'', label:'', slots:7 })
  const [newHoliday, setNewHoliday] = useState({ date:'', name:'', is_closed:true })

  async function addSlot(dk) {
    await supabase.from('template_slots').insert({
      org_id: orgId, day_of_week: dayTab, dept: dk,
      shift_name: Object.keys(shiftTemplates)[0] || 'Ochtend',
      count: 1, is_recurring: true,
    })
    onReload(); show('✓ Slot toegevoegd')
  }

  async function updateSlot(id, changes) {
    await supabase.from('template_slots').update(changes).eq('id', id)
    onReload()
  }

  async function removeSlot(id) {
    await supabase.from('template_slots').delete().eq('id', id)
    onReload(); show('✓ Slot verwijderd')
  }

  async function addPeak() {
    if (!newPeak.date) return
    await supabase.from('peak_moments').insert({ org_id: orgId, ...newPeak })
    setNewPeak({ date:'', label:'', slots:7 }); onReload(); show('✓ Piek moment toegevoegd')
  }

  async function addHoliday() {
    if (!newHoliday.date || !newHoliday.name) return
    await supabase.from('public_holidays').insert({ org_id: orgId, ...newHoliday })
    setNewHoliday({ date:'', name:'', is_closed:true }); onReload(); show('✓ Feestdag toegevoegd')
  }

  const daySlots = templateSlots.filter(s => s.is_recurring && s.day_of_week === dayTab)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ fontWeight:900, fontSize:20, color:C.ink }}>Bezettingstemplate</div>

      {/* Day tabs */}
      <div style={{ display:'flex', gap:4, overflowX:'auto' }}>
        {DAYS_FULL.map((d, di) => {
          const count = templateSlots.filter(s => s.is_recurring && s.day_of_week === di).reduce((a, s) => a+s.count, 0)
          return (
            <button key={di} onClick={() => setDayTab(di)}
              style={{ ...btn(), flexShrink:0, padding:'9px 14px', borderRadius:10, fontSize:13, fontWeight:700,
                background:dayTab===di?C.ink:'transparent', color:dayTab===di?C.white:C.inkMuted,
                border:`1.5px solid ${dayTab===di?C.ink:C.border}` }}>
              {DAYS[di]}
              {count > 0 && <span style={{ marginLeft:5, background:dayTab===di?C.gold:C.jade,
                color:C.white, borderRadius:99, fontSize:9, padding:'1px 6px', fontWeight:800 }}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Slot editor */}
      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:16 }}>{DAYS_FULL[dayTab]}</div>
        {DEPT_KEYS.map(dk => {
          const dept = DEPTS[dk]
          const slots = daySlots.filter(s => s.dept === dk)
          return (
            <div key={dk} style={{ marginBottom:20, paddingBottom:20, borderBottom:`1px solid ${C.borderLight}` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:18 }}>{dept.icon}</span>
                  <span style={{ fontWeight:800, color:dept.color, fontSize:14 }}>{dept.label}</span>
                  {slots.length > 0 && <Badge color={dept.color}>{slots.reduce((a,s)=>a+s.count,0)} pers.</Badge>}
                </div>
                <button onClick={() => addSlot(dk)}
                  style={{ ...btn(), background:dept.color+'18', color:dept.color,
                    border:`1px solid ${dept.color}44`, padding:'5px 12px', fontSize:12, borderRadius:8 }}>
                  ＋ Dienst
                </button>
              </div>
              {slots.length === 0 && <div style={{ color:C.inkMuted, fontSize:12, fontStyle:'italic' }}>Geen diensten op {DAYS_FULL[dayTab]}</div>}
              {slots.map(slot => (
                <div key={slot.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8,
                  padding:'10px 12px', background:C.surfaceAlt, borderRadius:10 }}>
                  <select value={slot.shift_name}
                    onChange={e => updateSlot(slot.id, { shift_name: e.target.value })}
                    style={{ flex:2, padding:'7px 10px', borderRadius:8, border:`1px solid ${C.border}`, fontSize:13, color:C.ink }}>
                    {Object.keys(shiftTemplates).map(n => {
                      const t = shiftTemplates[n]
                      return <option key={n} value={n}>{n} ({t.start_time}–{t.end_time})</option>
                    })}
                  </select>
                  <div style={{ display:'flex', alignItems:'center', gap:6, background:C.surface,
                    borderRadius:8, border:`1px solid ${C.border}`, padding:'4px 8px', flexShrink:0 }}>
                    <button onClick={() => updateSlot(slot.id, { count: Math.max(1, slot.count-1) })}
                      style={{ ...btn(), background:'transparent', color:C.ink, padding:'0 6px', fontSize:16, borderRadius:4 }}>−</button>
                    <span style={{ fontWeight:800, fontSize:14, minWidth:20, textAlign:'center', color:C.ink }}>{slot.count}</span>
                    <button onClick={() => updateSlot(slot.id, { count: slot.count+1 })}
                      style={{ ...btn(), background:'transparent', color:C.ink, padding:'0 6px', fontSize:16, borderRadius:4 }}>＋</button>
                  </div>
                  <span style={{ color:C.inkMuted, fontSize:12, flexShrink:0 }}>{slot.count} pers.</span>
                  <button onClick={() => removeSlot(slot.id)}
                    style={{ ...btn(), background:C.crimsonSoft, color:C.crimson, padding:'5px 9px', borderRadius:7, fontSize:12 }}>✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </Card>

      {/* Peak moments */}
      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🔥 Piek momenten</div>
        <div style={{ color:C.inkMuted, fontSize:13, marginBottom:16 }}>Specifieke datums waarop extra personeel wordt ingeroosterd</div>
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          <input type="date" value={newPeak.date} onChange={e => setNewPeak(p => ({...p, date:e.target.value}))}
            style={{ flex:1, padding:'9px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, minWidth:130 }}/>
          <input type="text" value={newPeak.label} onChange={e => setNewPeak(p => ({...p, label:e.target.value}))}
            placeholder="Omschrijving (bijv. Oud & Nieuw)"
            style={{ flex:2, padding:'9px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, minWidth:150 }}/>
          <button onClick={addPeak} style={{ ...btn(), background:C.crimson+'18', color:C.crimson,
            border:`1px solid ${C.crimson}44`, padding:'9px 14px', fontSize:13, borderRadius:10 }}>＋ Toevoegen</button>
        </div>
        {peakMoments.length === 0 && <div style={{ color:C.inkMuted, fontSize:12, fontStyle:'italic' }}>Nog geen piek momenten</div>}
        {peakMoments.map(p => (
          <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'9px 12px', background:C.surfaceAlt, borderRadius:10, marginBottom:6 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:13 }}>{p.label || 'Piek dag'}</div>
              <div style={{ color:C.inkMuted, fontSize:11 }}>{p.date} · 🔥 +1 per afdeling</div>
            </div>
            <button onClick={async () => { await supabase.from('peak_moments').delete().eq('id', p.id); onReload(); show('Verwijderd') }}
              style={{ ...btn(), background:C.crimsonSoft, color:C.crimson, padding:'5px 10px', fontSize:11, borderRadius:8 }}>✕</button>
          </div>
        ))}
      </Card>

      {/* Holidays */}
      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🎉 Feestdagen</div>
        <div style={{ color:C.inkMuted, fontSize:13, marginBottom:16 }}>Feestdagen = 150% loonkosten. Stel in of gesloten of met aangepaste bezetting.</div>
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          <input type="date" value={newHoliday.date} onChange={e => setNewHoliday(h => ({...h, date:e.target.value}))}
            style={{ flex:1, padding:'9px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, minWidth:130 }}/>
          <input type="text" value={newHoliday.name} onChange={e => setNewHoliday(h => ({...h, name:e.target.value}))}
            placeholder="Naam (bijv. Koningsdag)"
            style={{ flex:2, padding:'9px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, minWidth:150 }}/>
          <button onClick={addHoliday} style={{ ...btn(), background:C.jade+'18', color:C.jade,
            border:`1px solid ${C.jade}44`, padding:'9px 14px', fontSize:13, borderRadius:10 }}>＋ Toevoegen</button>
        </div>
        {holidays.length === 0 && <div style={{ color:C.inkMuted, fontSize:12, fontStyle:'italic' }}>Nog geen feestdagen</div>}
        {holidays.map(h => (
          <div key={h.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'9px 12px', background:C.surfaceAlt, borderRadius:10, marginBottom:6 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:13 }}>{h.name}</div>
              <div style={{ color:C.inkMuted, fontSize:11 }}>{h.date} · {h.is_closed ? '🔒 Gesloten' : '📋 Aangepaste bezetting'} · 💶 150%</div>
            </div>
            <button onClick={async () => { await supabase.from('public_holidays').delete().eq('id', h.id); onReload(); show('Verwijderd') }}
              style={{ ...btn(), background:C.crimsonSoft, color:C.crimson, padding:'5px 10px', fontSize:11, borderRadius:8 }}>✕</button>
          </div>
        ))}
      </Card>
    </div>
  )
}

function AanvragenTab({ pendingLeaves, pendingSwaps, onLeave, onSwap }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ fontWeight:900, fontSize:20, color:C.ink }}>Aanvragen</div>
      {pendingLeaves.length === 0 && pendingSwaps.length === 0 && (
        <Card style={{ textAlign:'center', padding:48 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
          <div style={{ color:C.inkMuted }}>Geen openstaande aanvragen</div>
        </Card>
      )}
      {pendingLeaves.map(l => (
        <Card key={l.id} style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12 }}>
            <Avatar name={l.staff?.name || '?'} color={l.staff?.color || C.sky} size={38}/>
            <div>
              <div style={{ fontWeight:700, color:C.ink }}>{l.staff?.name}</div>
              <div style={{ color:C.inkMuted, fontSize:13 }}>{l.date} — {l.reason}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => onLeave(l.id, 'rejected')}
              style={{ ...btn(), flex:1, background:C.crimsonSoft, color:C.crimson,
                border:`1px solid ${C.crimson}33`, padding:'10px', borderRadius:10, fontSize:13 }}>✗ Afwijzen</button>
            <button onClick={() => onLeave(l.id, 'approved')}
              style={{ ...btn(), flex:2, background:C.jade, color:C.white, padding:'10px', borderRadius:10, fontSize:13 }}>✓ Goedkeuren</button>
          </div>
        </Card>
      ))}
      {pendingSwaps.map(sw => (
        <Card key={sw.id} style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
            <Avatar name={sw.from_staff?.name || '?'} color={sw.from_staff?.color || C.sky} size={32}/>
            <div><div style={{ fontWeight:700, fontSize:13 }}>{sw.from_staff?.name}</div><div style={{ color:C.inkMuted, fontSize:11 }}>{sw.from_date}</div></div>
            <div style={{ fontSize:20, color:C.inkMuted }}>⇄</div>
            <Avatar name={sw.to_staff?.name || '?'} color={sw.to_staff?.color || C.jade} size={32}/>
            <div><div style={{ fontWeight:700, fontSize:13 }}>{sw.to_staff?.name}</div><div style={{ color:C.inkMuted, fontSize:11 }}>{sw.to_date}</div></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => onSwap(sw.id, 'rejected')}
              style={{ ...btn(), flex:1, background:C.crimsonSoft, color:C.crimson,
                border:`1px solid ${C.crimson}33`, padding:'10px', borderRadius:10, fontSize:13 }}>✗ Afwijzen</button>
            <button onClick={() => onSwap(sw.id, 'approved')}
              style={{ ...btn(), flex:2, background:C.jade, color:C.white, padding:'10px', borderRadius:10, fontSize:13 }}>✓ Goedkeuren</button>
          </div>
        </Card>
      ))}
    </div>
  )
}

function PersoneelTab({ allStaff, capacities, orgId, onReload, show, shiftTemplates, currentSchedule, overtimeLog }) {
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [capId, setCapId] = useState(null)
  const [localScores, setLocalScores] = useState({})
  const emptyForm = { name:'', email:'', password:'', role:'', color:'#1D4ED8',
    contract_type:'vast', contract_hours:20, min_hours:8, max_hours:32, hourly_rate:12, depts:[] }
  const [form, setForm] = useState(emptyForm)

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function saveStaff() {
    if (!form.name || !form.email || !form.depts.length) { show('Vul naam, e-mail en afdeling in'); return }
    try {
      if (editId) {
        await supabase.from('staff').update({
          name:form.name, email:form.email, role:form.role, color:form.color,
          contract_type:form.contract_type, contract_hours:form.contract_hours,
          min_hours:form.min_hours, max_hours:form.max_hours,
          hourly_rate:form.hourly_rate, depts:form.depts,
        }).eq('id', editId)
        show(`✓ ${form.name} bijgewerkt`)
      } else {
        // Create auth user
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
          email: form.email, password: form.password, email_confirm: true
        })
        if (authErr) {
          // If admin API not available, use signUp
          await supabase.auth.signUp({ email:form.email, password:form.password })
        }
        await supabase.from('staff').insert({
          org_id: orgId, auth_id: authData?.user?.id,
          name:form.name, email:form.email, role:form.role, color:form.color,
          contract_type:form.contract_type, contract_hours:form.contract_hours,
          min_hours:form.min_hours, max_hours:form.max_hours,
          hourly_rate:form.hourly_rate, depts:form.depts, is_active:true,
        })
        show(`✓ ${form.name} toegevoegd — uitnodiging verstuurd naar ${form.email}`)
      }
      setModal(false); setEditId(null); setForm(emptyForm); onReload()
    } catch (e) { show('Fout: ' + e.message) }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontWeight:900, fontSize:20, color:C.ink }}>Personeel</div>
        <button onClick={() => { setForm(emptyForm); setEditId(null); setModal(true) }}
          style={{ ...btn(), background:C.ink, color:C.white, padding:'10px 18px', fontSize:13, borderRadius:11 }}>
          ＋ Medewerker toevoegen
        </button>
      </div>

      {allStaff.length === 0 && (
        <Card style={{ textAlign:'center', padding:48 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>👥</div>
          <div style={{ fontWeight:700, fontSize:16, color:C.ink, marginBottom:6 }}>Nog geen medewerkers</div>
          <div style={{ color:C.inkMuted, fontSize:13, marginBottom:20 }}>Voeg je eerste medewerker toe</div>
          <button onClick={() => { setForm(emptyForm); setModal(true) }}
            style={{ ...btn(), background:C.ink, color:C.white, padding:'11px 22px', fontSize:14, borderRadius:11 }}>
            ＋ Medewerker toevoegen
          </button>
        </Card>
      )}

      {allStaff.map(s => {
        const hrs = (currentSchedule[s.id] || []).reduce((a, sh) => {
          if (!sh || !shiftTemplates[sh]) return a
          const t = shiftTemplates[sh]
          return a + (parseTime(t.end_time) - parseTime(t.start_time) - t.break_minutes) / 60
        }, 0)
        const ot = overtimeLog[s.id] || 0
        const pct = Math.min(100, Math.round(hrs / (s.contract_hours || 20) * 100))
        const contractMax = s.contract_type === 'min_max' ? s.max_hours : s.contract_hours

        return (
          <Card key={s.id} style={{ padding:16 }}>
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <Avatar name={s.name} color={s.color} size={46}/>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, color:C.ink }}>{s.name}</div>
                    <div style={{ color:C.inkMuted, fontSize:12 }}>{s.role} · {s.email}</div>
                    <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
                      {s.depts?.map(d => <Badge key={d} color={DEPTS[d]?.color || C.sky} style={{ fontSize:9, padding:'2px 7px' }}>{DEPTS[d]?.icon} {DEPTS[d]?.label}</Badge>)}
                      <Badge color={CONTRACT_TYPES[s.contract_type]?.color || C.jade} style={{ fontSize:9 }}>
                        {CONTRACT_TYPES[s.contract_type]?.label}
                      </Badge>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:900, fontSize:15, color:C.gold }}>€{(s.hourly_rate || 0).toFixed(2)}/u</div>
                    <div style={{ color:C.inkMuted, fontSize:11 }}>
                      {hrs.toFixed(0)}u / {contractMax || 20}u
                      {ot > 0 && <span style={{ color:C.amber, fontWeight:700 }}> · {ot.toFixed(1)}u OT</span>}
                    </div>
                  </div>
                </div>
                <div style={{ height:5, background:'#EBE7DE', borderRadius:99, overflow:'hidden', margin:'10px 0 6px' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:pct>100?C.crimson:pct>85?C.amber:C.jade, borderRadius:99 }}/>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => {
                    setForm({ name:s.name, email:s.email, role:s.role||'', color:s.color,
                      contract_type:s.contract_type, contract_hours:s.contract_hours,
                      min_hours:s.min_hours||8, max_hours:s.max_hours||32,
                      hourly_rate:s.hourly_rate, depts:s.depts||[], password:'' })
                    setEditId(s.id); setModal(true)
                  }} style={{ ...btn(), flex:1, background:'#EBE7DE', color:C.inkMid, padding:'7px', fontSize:12, borderRadius:9 }}>✏️ Bewerken</button>
                  <button onClick={() => setCapId(capId===s.id?null:s.id)}
                    style={{ ...btn(), flex:1, background:capId===s.id?C.ink:'#EBE7DE', color:capId===s.id?C.white:C.inkMid, padding:'7px', fontSize:12, borderRadius:9 }}>⭐ Capaciteit</button>
                  <button onClick={async () => { await supabase.from('staff').update({ is_active:!s.is_active }).eq('id', s.id); onReload() }}
                    style={{ ...btn(), flex:1, background:s.is_active?C.crimsonSoft:C.jadeSoft, color:s.is_active?C.crimson:C.jade, padding:'7px', fontSize:12, borderRadius:9 }}>
                    {s.is_active ? 'Deactiveren' : 'Activeren'}
                  </button>
                </div>

                {capId === s.id && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid #EEE9E0` }}>
                    <div style={{ fontWeight:700, fontSize:13, marginBottom:10, color:C.inkMid }}>Capaciteitsscores (1–10)</div>
                    {(s.depts || []).map(dk => {
                      const dept = DEPTS[dk]
                      const score = (localScores[s.id]?.[dk] !== undefined ? localScores[s.id]?.[dk] : capacities[s.id]?.[dk]) ?? 5
                      return (
                        <div key={dk} style={{ marginBottom:10 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                            <span style={{ fontWeight:700, fontSize:13, color:dept?.color }}>{dept?.icon} {dept?.label}</span>
                            <span style={{ fontWeight:800, color:score>=8?C.jade:score>=5?dept?.color:C.crimson }}>{score}/10</span>
                          </div>
                          <input type="range" min={1} max={10} value={score}
                            onChange={e => {
                              // Update local display only - no re-render of parent
                              setLocalScores(ls => ({
                                ...ls,
                                [s.id]: { ...(ls[s.id]||{}), [dk]: +e.target.value }
                              }))
                            }}
                            onMouseUp={async e => {
                              const val = +e.target.value
                              // Update local capacities display
                              setLocalScores(ls => ({
                                ...ls,
                                [s.id]: { ...(ls[s.id]||{}), [dk]: val }
                              }))
                              // Save to DB without triggering full reload
                              await supabase.from('capacity_scores').upsert({
                                staff_id:s.id, dept:dk, score:val
                              }, { onConflict:'staff_id,dept' })
                              show('✓ Score opgeslagen')
                            }}
                            onTouchEnd={async e => {
                              const val = localScores[s.id]?.[dk] ?? capacities[s.id]?.[dk] ?? 5
                              await supabase.from('capacity_scores').upsert({
                                staff_id:s.id, dept:dk, score:val
                              }, { onConflict:'staff_id,dept' })
                              show('✓ Score opgeslagen')
                            }}
                            style={{ width:'100%', accentColor:dept?.color, cursor:'pointer', height:6 }}/>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )
      })}

      {/* Staff modal */}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex',
          alignItems:'center', justifyContent:'center', zIndex:999, padding:16 }}
          onClick={() => setModal(false)}>
          <div style={{ background:C.surface, borderRadius:20, padding:24, width:'100%', maxWidth:480,
            maxHeight:'90vh', overflowY:'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:18 }}>
              {editId ? 'Medewerker bewerken' : 'Nieuwe medewerker'}
            </div>
            {[['Volledige naam *','name','text','Voor- en achternaam'],['E-mailadres *','email','email','naam@restaurant.nl'],
              ['Functie','role','text','Bijv. Barista, Kok...']].map(([l,k,t,p]) => (
              <div key={k} style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>{l}</div>
                <input type={t} value={form[k]} onChange={e => f(k, e.target.value)} placeholder={p}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`,
                    fontSize:14, fontFamily:'inherit', color:C.ink, boxSizing:'border-box' }}/>
              </div>
            ))}
            {!editId && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Tijdelijk wachtwoord *</div>
                <input type="password" value={form.password} onChange={e => f('password', e.target.value)}
                  placeholder="Medewerker kan dit zelf wijzigen"
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`,
                    fontSize:14, fontFamily:'inherit', color:C.ink, boxSizing:'border-box' }}/>
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Contracttype</div>
                <select value={form.contract_type} onChange={e => f('contract_type', e.target.value)}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14 }}>
                  {Object.entries(CONTRACT_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>
                  {form.contract_type === 'min_max' ? 'Min uren/week' : 'Contract uren/week'}
                </div>
                <input type="number" value={form.contract_hours} onChange={e => f('contract_hours', +e.target.value)}
                  min={0} max={40} step={1}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
              </div>
            </div>
            {form.contract_type === 'min_max' && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Max uren/week</div>
                <input type="number" value={form.max_hours} onChange={e => f('max_hours', +e.target.value)}
                  min={0} max={60} step={1}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
              </div>
            )}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Uurloon (€) — alleen admin</div>
              <input type="number" value={form.hourly_rate} onChange={e => f('hourly_rate', +e.target.value)}
                min={8} max={50} step={0.25}
                style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:8 }}>Afdelingen *</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {DEPT_KEYS.map(dk => {
                  const dept = DEPTS[dk], active = form.depts.includes(dk)
                  return (
                    <button key={dk} onClick={() => f('depts', active ? form.depts.filter(d=>d!==dk) : [...form.depts, dk])}
                      style={{ ...btn(), padding:'8px 12px', fontSize:12, borderRadius:9,
                        background:active?dept.color+'18':'transparent',
                        border:`1.5px solid ${active?dept.color:C.border}`,
                        color:active?dept.color:C.inkMuted, fontWeight:active?700:500 }}>
                      {dept.icon} {dept.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:8 }}>Profielkleur</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {['#1D4ED8','#2A7D5C','#B84C2C','#C4882A','#5E30A0','#0A7B8A','#A8281C','#A0620A'].map(c => (
                  <div key={c} onClick={() => f('color', c)}
                    style={{ width:28, height:28, borderRadius:8, background:c, cursor:'pointer',
                      border:`3px solid ${form.color===c?C.ink:'transparent'}`, transition:'all .15s' }}/>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setModal(false)}
                style={{ ...btn(), flex:1, background:'#EBE7DE', color:C.inkMid, padding:'13px', borderRadius:12 }}>Annuleren</button>
              <button onClick={saveStaff}
                style={{ ...btn(), flex:2, background:C.ink, color:C.white, padding:'13px', borderRadius:12 }}>
                {editId ? 'Opslaan' : 'Aanmaken'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FinancieelTab({ fin, allStaff, currentSchedule, shiftTemplates, currentWeek, weekIdx, weeks, setWeekIdx, DAYS }) {
  const maxCost = Math.max(...fin.rows.map(r => r.cost), 1)
  const maxDay = Math.max(...DAYS.map((_, di) => {
    return allStaff.filter(s => s.is_active && currentSchedule[s.id]?.[di]).reduce((a, s) => {
      const sh = currentSchedule[s.id]?.[di]
      const t = sh && shiftTemplates[sh]
      return a + (t ? (parseTime(t.end_time) - parseTime(t.start_time) - t.break_minutes) / 60 * s.hourly_rate : 0)
    }, 0)
  }), 1)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div style={{ fontWeight:900, fontSize:22, color:C.ink }}>Financieel</div>
        <WeekNav week={weekIdx} weeks={weeks.map(w=>w.label)} setWeek={setWeekIdx} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
        {[
          { l:'Loonkosten', v:`€${fin.totalCost.toFixed(0)}`, icon:'💶', c:C.terra },
          { l:'Totaal uren', v:`${fin.totalHours.toFixed(0)}u`, icon:'⏱', c:C.sky },
          { l:'Overwerk', v:`${fin.totalOT.toFixed(1)}u`, icon:'⚠️', c:fin.totalOT>0?C.amber:C.jade },
          { l:'Feestdag uren', v:`${fin.totalFestHours.toFixed(0)}u`, icon:'🎉', c:fin.totalFestHours>0?C.crimson:C.jade },
        ].map(s => (
          <Card key={s.l} style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{s.icon}</div>
            <div style={{ color:s.c, fontSize:20, fontWeight:900 }}>{s.v}</div>
            <div style={{ color:C.inkMuted, fontSize:11, marginTop:2 }}>{s.l}</div>
          </Card>
        ))}
      </div>

      {fin.totalOT > 0 && (
        <div style={{ background:C.amberSoft, border:`1px solid ${C.amber}44`, borderRadius:12, padding:'10px 16px', display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:18 }}>⚠️</span>
          <div>
            <div style={{ fontWeight:700, color:C.amber, fontSize:13 }}>Overwerk gedetecteerd</div>
            <div style={{ color:C.inkMuted, fontSize:12 }}>{fin.totalOT.toFixed(1)}u overwerk × 1.5 = €{fin.rows.reduce((a,r)=>a+Math.max(0,r.otHours-r.festHours)*r.hourlyRate*0.5,0).toFixed(2)} extra</div>
          </div>
        </div>
      )}

      {fin.totalFestHours > 0 && (
        <div style={{ background:C.crimsonSoft, border:`1px solid ${C.crimson}44`, borderRadius:12, padding:'10px 16px', display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:18 }}>🎉</span>
          <div>
            <div style={{ fontWeight:700, color:C.crimson, fontSize:13 }}>Feestdagtoeslag (150%)</div>
            <div style={{ color:C.inkMuted, fontSize:12 }}>{fin.totalFestHours.toFixed(0)}u × 1.5 = €{fin.rows.reduce((a,r)=>a+r.festHours*r.hourlyRate*0.5,0).toFixed(2)} toeslag</div>
          </div>
        </div>
      )}

      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:700, fontSize:14, color:C.inkMid, marginBottom:14 }}>LOONKOSTEN PER MEDEWERKER</div>
        {fin.rows.length === 0 && <div style={{ color:C.inkMuted, fontSize:13, fontStyle:'italic' }}>Geen medewerkers ingeroosterd</div>}
        {fin.rows.sort((a,b)=>b.cost-a.cost).map(r => (
          <div key={r.id} style={{ marginBottom:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:5 }}>
              <Avatar name={r.name} color={r.color} size={28}/>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                  <span style={{ fontWeight:700, fontSize:13, color:C.ink }}>{r.name.split(' ')[0]}</span>
                  <div style={{ textAlign:'right' }}>
                    <span style={{ fontWeight:900, color:C.terra, fontSize:14 }}>€{r.cost.toFixed(2)}</span>
                    <span style={{ color:C.inkMuted, fontSize:11, marginLeft:6 }}>{r.hours.toFixed(0)}u × €{r.hourlyRate}/u</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ height:7, background:'#EBE7DE', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${(r.cost/maxCost)*100}%`, background:r.otHours>0?C.amber:r.color, borderRadius:99 }}/>
            </div>
            {r.otHours > 0 && <div style={{ fontSize:11, color:C.amber, marginTop:3 }}>⚠ {r.otHours.toFixed(1)}u OT</div>}
            {r.festHours > 0 && <div style={{ fontSize:11, color:C.crimson, marginTop:2 }}>🎉 {r.festHours.toFixed(1)}u feestdag (€{(r.festHours*r.hourlyRate*0.5).toFixed(2)} toeslag)</div>}
          </div>
        ))}
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontWeight:700, color:C.ink }}>Totaal</span>
          <span style={{ fontWeight:900, color:C.terra, fontSize:18 }}>€{fin.totalCost.toFixed(2)}</span>
        </div>
      </Card>

      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:700, fontSize:14, color:C.inkMid, marginBottom:14 }}>KOSTEN PER DAG</div>
        <div style={{ display:'flex', gap:6 }}>
          {DAYS.map((d, di) => {
            const dayCost = allStaff.filter(s => s.is_active && currentSchedule[s.id]?.[di]).reduce((a, s) => {
              const sh = currentSchedule[s.id]?.[di]
              const t = sh && shiftTemplates[sh]
              return a + (t ? (parseTime(t.end_time)-parseTime(t.start_time)-t.break_minutes)/60*s.hourly_rate : 0)
            }, 0)
            const isFest = fin.festDates?.has(currentWeek.dates[di])
            return (
              <div key={d} style={{ flex:1, textAlign:'center' }}>
                <div style={{ height:60, display:'flex', alignItems:'flex-end', justifyContent:'center', marginBottom:4 }}>
                  <div style={{ width:'70%', height:`${Math.max(6,(dayCost/maxDay)*54)}px`,
                    background:isFest?C.crimson:C.sky, borderRadius:'4px 4px 0 0', opacity:0.85 }}/>
                </div>
                <div style={{ fontWeight:700, fontSize:10, color:isFest?C.crimson:C.inkMuted }}>{d}{isFest?' 🎉':''}</div>
                <div style={{ color:C.ink, fontWeight:800, fontSize:11 }}>€{dayCost.toFixed(0)}</div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function InstellingenTab({ settings, orgId, shiftTemplates, onReload, show }) {
  const [s, setS] = useState(settings)
  const [tmplModal, setTmplModal] = useState(false)
  const [editTmpl, setEditTmpl] = useState(null)

  useEffect(() => setS(settings), [settings])

  async function saveSettings() {
    await supabase.from('org_settings').upsert({ org_id: orgId, ...s }, { onConflict: 'org_id' })
    show('✓ Instellingen opgeslagen')
  }

  async function saveTmpl() {
    if (!editTmpl?.name) { show('Naam verplicht'); return }
    if (editTmpl._isNew) {
      await supabase.from('shift_templates').insert({
        org_id: orgId, name: editTmpl.name,
        start_time: editTmpl.start_time, end_time: editTmpl.end_time,
        break_minutes: editTmpl.break_minutes,
      })
    } else {
      await supabase.from('shift_templates').update({
        name: editTmpl.name, start_time: editTmpl.start_time,
        end_time: editTmpl.end_time, break_minutes: editTmpl.break_minutes,
      }).eq('id', editTmpl.id)
    }
    setTmplModal(false); onReload(); show(`✓ ${editTmpl.name} ${editTmpl._isNew?'toegevoegd':'bijgewerkt'}`)
  }

  const inp = (label, key, type='number', extra={}) => (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>{label}</div>
      <input type={type} value={s[key]||''} onChange={e => setS(p=>({...p,[key]:type==='number'?+e.target.value:e.target.value}))}
        style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`,
          fontSize:14, fontFamily:'inherit', color:C.ink, boxSizing:'border-box' }} {...extra}/>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ fontWeight:900, fontSize:20, color:C.ink }}>Instellingen</div>

      <Card style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontWeight:800, fontSize:15 }}>Dienst templates</div>
          <button onClick={() => { setEditTmpl({ _isNew:true, name:'', start_time:'09:00', end_time:'17:00', break_minutes:30 }); setTmplModal(true) }}
            style={{ ...btn(), background:C.ink, color:C.white, padding:'7px 14px', fontSize:12, borderRadius:9 }}>＋ Nieuwe dienst</button>
        </div>
        {Object.values(shiftTemplates).map(t => (
          <div key={t.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:`1px solid #EEE9E0` }}>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:C.ink }}>{t.name}</div>
              <div style={{ color:C.inkMuted, fontSize:12 }}>{t.start_time}–{t.end_time} · {((parseTime(t.end_time)-parseTime(t.start_time)-t.break_minutes)/60).toFixed(1)}u · {t.break_minutes}min pauze</div>
            </div>
            <button onClick={() => { setEditTmpl({...t, _isNew:false}); setTmplModal(true) }}
              style={{ ...btn(), background:'#EBE7DE', color:C.inkMid, padding:'7px 14px', fontSize:12, borderRadius:9 }}>Bewerken</button>
          </div>
        ))}
      </Card>

      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:14 }}>Rooster instellingen</div>
        {inp('Max dagen per week','max_days_per_week','number',{min:1,max:7,step:1})}
        {inp('Max overwerk uren per week','max_overtime_hours','number',{min:0,max:20,step:0.5})}
        {inp('Minimale rust tussen diensten (uren)','min_rest_hours','number',{min:0,max:24,step:0.5})}
        <button onClick={saveSettings} style={{ ...btn(), background:C.ink, color:C.white, padding:'11px', width:'100%', fontSize:14, borderRadius:11 }}>Opslaan</button>
      </Card>

      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:14 }}>📧 E-mail (Resend)</div>
        {inp('Resend API Key','resend_api_key','text')}
        {inp('Verzendadres','sender_email','email')}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 14px',
          background:s.auto_email_enabled?C.jadeSoft:'#EBE7DE', borderRadius:12, marginBottom:14,
          border:`1px solid ${s.auto_email_enabled?C.jade+'44':C.border}` }}>
          <div>
            <div style={{ fontWeight:700, fontSize:13 }}>Automatische herinnering op de 10e</div>
            <div style={{ color:C.inkMuted, fontSize:12, marginTop:2 }}>Stuurt email naar medewerkers zonder beschikbaarheid</div>
          </div>
          <button onClick={() => setS(p=>({...p,auto_email_enabled:!p.auto_email_enabled}))}
            style={{ ...btn(), padding:'8px 16px', fontSize:13, borderRadius:10,
              background:s.auto_email_enabled?C.jade:'#EBE7DE', color:s.auto_email_enabled?C.white:C.inkMid,
              border:`1px solid ${s.auto_email_enabled?C.jade:C.border}`, flexShrink:0, marginLeft:12 }}>
            {s.auto_email_enabled?'Aan':'Uit'}
          </button>
        </div>
        <button onClick={saveSettings} style={{ ...btn(), background:C.jade, color:C.white, padding:'11px', width:'100%', fontSize:14, borderRadius:11 }}>Opslaan</button>
      </Card>

      <Card style={{ padding:20 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🔄 App updaten</div>
        <div style={{ color:C.inkMuted, fontSize:13, marginBottom:14 }}>Laad een nieuwe versie door updatecode + URL in te voeren</div>
        {inp('Update URL','update_url','url')}
        {inp('Update code','update_code','text')}
        <button onClick={saveSettings} style={{ ...btn(), background:C.ink, color:C.white, padding:'11px', width:'100%', fontSize:14, borderRadius:11 }}>Opslaan</button>
      </Card>

      {tmplModal && editTmpl && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999, padding:16 }} onClick={() => setTmplModal(false)}>
          <div style={{ background:C.surface, borderRadius:20, padding:24, width:'100%', maxWidth:380 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:18 }}>{editTmpl._isNew?'Nieuwe diensttijd':'Diensttijd bewerken'}</div>
            {[['Naam *','name','text'],['Starttijd','start_time','time'],['Eindtijd','end_time','time']].map(([l,k,t]) => (
              <div key={k} style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>{l}</div>
                <input type={t} value={editTmpl[k]||''} onChange={e => setEditTmpl(p=>({...p,[k]:e.target.value}))}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, fontFamily:'inherit', boxSizing:'border-box' }}/>
              </div>
            ))}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>Pauze (minuten)</div>
              <input type="number" value={editTmpl.break_minutes||0} onChange={e => setEditTmpl(p=>({...p,break_minutes:+e.target.value}))}
                min={0} max={90} step={5}
                style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:14, boxSizing:'border-box' }}/>
            </div>
            <div style={{ background:'#EBE7DE', borderRadius:10, padding:'10px 14px', marginBottom:16, fontSize:13, color:C.inkMid }}>
              Werktijd: <strong>{editTmpl.start_time&&editTmpl.end_time?((parseTime(editTmpl.end_time)-parseTime(editTmpl.start_time)-(editTmpl.break_minutes||0))/60).toFixed(1):0}u</strong>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setTmplModal(false)} style={{ ...btn(), flex:1, background:'#EBE7DE', color:C.inkMid, padding:'12px', borderRadius:12 }}>Annuleren</button>
              {!editTmpl._isNew && (
                <button onClick={async()=>{await supabase.from('shift_templates').delete().eq('id',editTmpl.id);setTmplModal(false);onReload();show('✓ Verwijderd')}}
                  style={{ ...btn(), background:C.crimsonSoft, color:C.crimson, padding:'12px 14px', borderRadius:12, fontSize:13 }}>🗑</button>
              )}
              <button onClick={saveTmpl} style={{ ...btn(), flex:2, background:C.ink, color:C.white, padding:'12px', borderRadius:12 }}>
                {editTmpl._isNew?'Toevoegen':'Opslaan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

