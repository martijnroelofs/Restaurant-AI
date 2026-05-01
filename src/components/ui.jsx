// ─── Shared UI Components ──────────────────────────────────────────────────────
export const C = {
  bg:'#F4F1EB', surface:'#FFFFFF', surfaceAlt:'#EBE7DE', borderLight:'#EEE9E0',
  border:'#DDD8CC', ink:'#1A2340', inkMid:'#3D4460', inkMuted:'#8A90A8',
  gold:'#C4882A', terra:'#B84C2C', terraSoft:'rgba(184,76,44,0.10)',
  jade:'#2A7D5C', jadeSoft:'rgba(42,125,92,0.12)',
  sky:'#1A5CB4', skySoft:'rgba(26,92,180,0.10)',
  amber:'#A0620A', amberSoft:'rgba(160,98,10,0.12)',
  crimson:'#A8281C', crimsonSoft:'rgba(168,40,28,0.10)',
  purple:'#5E30A0', teal:'#0A7B8A', white:'#FFFFFF',
}

export const DEPTS = {
  bar:        { label:'Bar',         icon:'🍸', color:C.sky,    min:2 },
  wijkloper:  { label:'Wijkloper',   icon:'🚶', color:C.purple, min:1 },
  runner:     { label:'Runner',      icon:'⚡', color:C.terra,  min:1 },
  keuken:     { label:'Keuken',      icon:'👨‍🍳', color:C.jade,   min:2 },
  spoelkeuken:{ label:'Spoelkeuken', icon:'🫧', color:C.teal,   min:1 },
}

export const CONTRACT_TYPES = {
  vast:     { label:'Vast',     color:C.jade   },
  oproep:   { label:'Oproep',   color:C.amber  },
  min_max:  { label:'Min/Max',  color:C.sky    },
  stagiair: { label:'Stagiair', color:C.purple },
}

export function Badge({ color, children, style = {} }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'3px 9px', borderRadius:99,
      background:color+'1A', color, fontSize:11, fontWeight:700, ...style
    }}>{children}</span>
  )
}

export function Card({ children, style = {}, onClick }) {
  return (
    <div onClick={onClick} style={{
      background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:16, padding:20, ...style,
      cursor:onClick?'pointer':undefined,
    }}>{children}</div>
  )
}

export function Avatar({ name, color, size = 36 }) {
  const initials = name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase() || '?'
  return (
    <div style={{
      width:size, height:size, borderRadius:Math.round(size/3),
      background:color+'22', border:`2px solid ${color}`,
      display:'flex', alignItems:'center', justifyContent:'center',
      color, fontSize:size*.34, fontWeight:800, flexShrink:0,
    }}>{initials}</div>
  )
}

export function Toast({ msg }) {
  return (
    <div style={{
      position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
      background:C.ink, color:C.white, borderRadius:14, padding:'13px 28px',
      fontWeight:700, fontSize:14, boxShadow:'0 8px 40px rgba(0,0,0,.2)',
      zIndex:9999, animation:'slideUp .3s ease', whiteSpace:'nowrap',
    }}>{msg}</div>
  )
}

export function Spinner() {
  return (
    <div style={{
      minHeight:'100vh', background:C.bg, display:'flex',
      alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16,
    }}>
      <div style={{ fontSize:40 }}>🍽</div>
      <div style={{ color:C.inkMuted, fontSize:14 }}>Laden...</div>
    </div>
  )
}

export function WeekNav({ week, weeks, setWeek }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:6, background:C.surfaceAlt,
      borderRadius:12, padding:'5px 10px', border:`1px solid ${C.border}`,
    }}>
      <button onClick={() => setWeek(w => Math.max(0, w-1))} disabled={week===0}
        style={{ border:'none', background:'transparent', color:week===0?C.inkMuted:C.ink,
          padding:'3px 8px', fontSize:16, cursor:week===0?'not-allowed':'pointer',
          opacity:week===0?0.3:1 }}>‹</button>
      <span style={{ color:C.ink, fontWeight:700, fontSize:13, minWidth:136, textAlign:'center' }}>
        {weeks[week]}
      </span>
      <button onClick={() => setWeek(w => Math.min(weeks.length-1, w+1))} disabled={week===weeks.length-1}
        style={{ border:'none', background:'transparent', color:C.ink,
          padding:'3px 8px', fontSize:16, cursor:week===weeks.length-1?'not-allowed':'pointer',
          opacity:week===weeks.length-1?0.3:1 }}>›</button>
    </div>
  )
}

export function Input({ label, value, onChange, type='text', placeholder, min, max, step, prefix, style={} }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>{label}</div>}
      <div style={{ position:'relative' }}>
        {prefix && <span style={{ position:'absolute', left:12, top:'50%',
          transform:'translateY(-50%)', color:C.inkMuted, fontSize:14 }}>{prefix}</span>}
        <input type={type} value={value} onChange={onChange} placeholder={placeholder}
          min={min} max={max} step={step}
          style={{ width:'100%', padding:`10px ${prefix?'36px':'12px'} 10px 12px`,
            borderRadius:10, border:`1px solid ${C.border}`, fontSize:14,
            fontFamily:'inherit', color:C.ink, boxSizing:'border-box', ...style }}/>
      </div>
    </div>
  )
}

export function Select({ label, value, onChange, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && <div style={{ fontSize:12, fontWeight:700, color:C.inkMid, marginBottom:5 }}>{label}</div>}
      <select value={value} onChange={onChange} style={{
        width:'100%', padding:'10px 12px', borderRadius:10,
        border:`1px solid ${C.border}`, fontSize:14,
        fontFamily:'inherit', color:C.ink, background:C.white,
      }}>{children}</select>
    </div>
  )
}

// Button style helper
export const btn = (overrides={}) => ({
  border:'none', borderRadius:9, fontWeight:700, cursor:'pointer',
  fontFamily:'inherit', transition:'all .18s', ...overrides,
})

// Week utilities
export function getWeekDates(mondayDate) {
  const d = new Date(mondayDate)
  return Array.from({ length:7 }, (_, i) => {
    const day = new Date(d)
    day.setDate(d.getDate() + i)
    return day.toISOString().split('T')[0]
  })
}

export function getMondayOfWeek(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('nl-NL', { day:'numeric', month:'short' })
}

export const DAYS = ['Ma','Di','Wo','Do','Vr','Za','Zo']
export const DAYS_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag']
