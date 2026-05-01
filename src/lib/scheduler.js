// ─── RoosterAI Schedule Generation Engine ────────────────────────────────────
// Rules:
// 1. Max maxDaysPerWeek days per staff member
// 2. Max contract hours + maxOvertimeHours per week
// 3. Minimum minRestHours between end of one shift and start of next
// 4. On busy/peak days: +1 per dept
// 5. Capacity scores prioritised on peak days
// 6. Recurring & date-specific template slots
// 7. Holiday overrides or closed days
// 8. Contract type awareness (oproep = flexible, stagiair = limited)
// 9. Previous week overtime compensation

const DEPT_KEYS = ['bar', 'wijkloper', 'runner', 'keuken', 'spoelkeuken']

function parseTime(timeStr) {
  // "08:00" → minutes from midnight
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function shiftHours(shift) {
  if (!shift) return 0
  const start = parseTime(shift.start_time)
  const end = parseTime(shift.end_time)
  return ((end - start) - shift.break_minutes) / 60
}

function hasMinRest(lastEnd, nextStart, minRestHours) {
  // lastEnd & nextStart are "HH:MM" strings on potentially different dates
  // We check by minutes — if nextStart is earlier than lastEnd we assume next day
  const last = parseTime(lastEnd)
  let next = parseTime(nextStart)
  if (next < last) next += 24 * 60 // next day
  return (next - last) >= (minRestHours * 60)
}

function getEffectiveMaxHours(staff, settings, otHistory) {
  const base = staff.contract_type === 'min_max'
    ? staff.max_hours
    : staff.contract_hours || 20

  const ot = otHistory[staff.id] || 0
  // If staff has overtime to compensate, reduce effective max
  const compensation = ot > 0 ? Math.min(ot, settings.max_overtime_hours) : 0
  return base + settings.max_overtime_hours - compensation
}

function getContractMax(staff) {
  if (staff.contract_type === 'stagiair') return staff.contract_hours || 16
  if (staff.contract_type === 'min_max') return staff.max_hours || 32
  if (staff.contract_type === 'oproep') return 40 // flexible
  return staff.contract_hours || 20
}

export function generateSchedule({
  staff,
  shiftTemplates,      // { name: { start_time, end_time, break_minutes } }
  templateSlots,       // [{ day_of_week, dept, shift_name, count, is_recurring, specific_date }]
  peakMoments,         // [{ date, slots }]
  holidays,            // [{ date, is_closed, holiday_slots: [{dept, shift_name, count}] }]
  availabilityPatterns, // { staffId: { dayOfWeek: slots_bitmask } }
  availabilityOverrides, // { staffId: { date: slots_bitmask } }
  leaveRequests,       // approved: [{ staff_id, date }]
  capacityScores,      // { staffId: { dept: score } }
  weekDates,           // ['2025-05-05', ..., '2025-05-11'] — 7 dates Mon-Sun
  settings = {},
  otHistory = {},      // { staffId: hoursOT }
}) {
  const {
    max_days_per_week = 5,
    max_overtime_hours = 4,
    min_rest_hours = 11,
  } = settings

  // Result: { staffId: [shift_name|null × 7] }
  const schedule = {}
  staff.forEach(s => { schedule[s.id] = Array(7).fill(null) })

  // Track hours planned per staff this week
  const hoursPlanned = {}
  staff.forEach(s => { hoursPlanned[s.id] = 0 })

  // Track last shift end time per staff (for rest check)
  const lastShiftEnd = {} // { staffId: 'HH:MM' }

  // Build leave set
  const leaveSet = new Set(
    (leaveRequests || [])
      .filter(l => l.status === 'approved')
      .map(l => `${l.staff_id}-${l.date}`)
  )

  // Process each day
  weekDates.forEach((date, di) => {
    const dayOfWeek = di // 0=Mon

    // Check holiday
    const holiday = (holidays || []).find(h => h.date === date)
    if (holiday?.is_closed) return // skip day entirely

    // Check peak
    const peak = (peakMoments || []).find(p => p.date === date)
    const isPeak = !!peak

    // Get slots for this day
    let daySlots
    if (holiday && !holiday.is_closed && holiday.holiday_slots?.length) {
      // Holiday override slots
      daySlots = holiday.holiday_slots
    } else {
      // Template slots: recurring for this weekday + date-specific
      daySlots = (templateSlots || []).filter(s =>
        (s.is_recurring && s.day_of_week === dayOfWeek) ||
        (!s.is_recurring && s.specific_date === date)
      )
      // On peak days: bump count by 1 per dept
      if (isPeak) {
        daySlots = daySlots.map(s => ({ ...s, count: s.count + 1 }))
      }
    }

    // Process each dept slot
    DEPT_KEYS.forEach(dk => {
      const deptSlots = daySlots.filter(s => s.dept === dk)
      deptSlots.forEach(slot => {
        const shift = shiftTemplates[slot.shift_name]
        if (!shift) return

        const slotBit = slot.shift_name === 'Ochtend' ? 1
          : slot.shift_name === 'Middag' ? 2
          : slot.shift_name === 'Avond' ? 4 : 7

        const shiftDuration = shiftHours(shift)

        // Find eligible staff
        const pool = staff.filter(s => {
          if (!s.is_active) return false
          if (!s.depts?.includes(dk)) return false
          if (schedule[s.id][di] !== null) return false // already assigned today
          if (leaveSet.has(`${s.id}-${date}`)) return false

          // Days count check
          const daysAssigned = schedule[s.id].filter(Boolean).length
          if (daysAssigned >= max_days_per_week) return false

          // Hours check
          const effectiveMax = getEffectiveMaxHours(s, { max_overtime_hours }, otHistory)
          if (hoursPlanned[s.id] + shiftDuration > effectiveMax) return false

          // Availability check
          const patternBits = availabilityPatterns?.[s.id]?.[dayOfWeek] ?? 0
          const overrideBits = availabilityOverrides?.[s.id]?.[date]
          const availBits = overrideBits !== undefined ? overrideBits : patternBits
          if (!availBits) return false
          if (availBits !== 7 && !(availBits & slotBit)) return false

          // Minimum rest check
          if (lastShiftEnd[s.id]) {
            if (!hasMinRest(lastShiftEnd[s.id], shift.start_time, min_rest_hours)) {
              return false
            }
          }

          // Contract type: stagiairs max 8h/day, oproep always eligible
          if (s.contract_type === 'stagiair' && shiftDuration > 8) return false

          return true
        })

        // Sort by capacity score (desc) on peak days, otherwise by hours worked (asc) for fairness
        pool.sort((a, b) => {
          if (isPeak) {
            const sa = capacityScores?.[a.id]?.[dk] ?? 5
            const sb = capacityScores?.[b.id]?.[dk] ?? 5
            return sb - sa
          }
          // Fair distribution: prefer staff with fewer hours this week
          return hoursPlanned[a.id] - hoursPlanned[b.id]
        })

        // Assign up to slot.count staff members
        let assigned = 0
        pool.forEach(s => {
          if (assigned >= slot.count) return
          schedule[s.id][di] = slot.shift_name
          hoursPlanned[s.id] += shiftDuration
          lastShiftEnd[s.id] = shift.end_time
          assigned++
        })
      })
    })
  })

  // Calculate overtime per staff
  const weekOT = {}
  staff.forEach(s => {
    const planned = hoursPlanned[s.id]
    const contractH = getContractMax(s)
    const ot = Math.max(0, planned - contractH)
    const prevOT = otHistory[s.id] || 0
    const compensation = planned < contractH ? Math.max(0, prevOT - (contractH - planned)) : prevOT
    weekOT[s.id] = ot > 0 ? prevOT + ot : compensation
  })

  return { schedule, hoursPlanned, weekOT }
}

// ─── Financial calculations ───────────────────────────────────────────────────
export function calcFinancials(staff, schedule, shiftTemplates, weekDates, holidays) {
  const festDates = new Set(
    (holidays || [])
      .filter(h => !h.is_closed)
      .map(h => h.date)
  )

  const rows = staff.filter(s => s.is_active).map(s => {
    const row = schedule[s.id] || Array(7).fill(null)
    let hours = 0, cost = 0, festHours = 0, otHours = 0

    row.forEach((shiftName, di) => {
      if (!shiftName) return
      const shift = shiftTemplates[shiftName]
      if (!shift) return
      const h = shiftHours(shift)
      const date = weekDates[di]
      const isFest = festDates.has(date)
      hours += h
      if (isFest) {
        festHours += h
        cost += h * s.hourly_rate * 1.5
      } else {
        cost += h * s.hourly_rate
      }
    })

    const contractH = getContractMax(s)
    otHours = Math.max(0, hours - contractH)
    // OT surcharge (0.5× extra) for non-feestdag OT
    const otExtra = Math.max(0, otHours - festHours) * s.hourly_rate * 0.5
    cost += otExtra

    return {
      id: s.id,
      name: s.name,
      color: s.color,
      depts: s.depts,
      contract_type: s.contract_type,
      hours,
      contractHours: contractH,
      otHours,
      festHours,
      cost,
      hourlyRate: s.hourly_rate,
    }
  })

  return {
    rows,
    totalHours: rows.reduce((a, r) => a + r.hours, 0),
    totalCost: rows.reduce((a, r) => a + r.cost, 0),
    totalOT: rows.reduce((a, r) => a + r.otHours, 0),
    totalFestHours: rows.reduce((a, r) => a + r.festHours, 0),
    festDates,
  }
}
