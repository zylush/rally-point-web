import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Figma Design source: UI/UX → color styles solid/primary/500 and
// solid/secondary/500. This generates the HTML source first, then SVG imports.
const out = dirname(fileURLToPath(import.meta.url))
const c = {
  navy: '#0A2749',
  blue: '#214B78',
  red: '#8A1D1D',
  ink: '#17263B',
  muted: '#526479',
  line: '#C9D4E1',
  paper: '#F7F9FC',
  pale: '#EAF0F7',
  redPale: '#F8EEEE',
  white: '#FFFFFF',
}
const W = 1600
const H = 900
const font = 'IBM Plex Sans, Arial, sans-serif'
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const rect = (x, y, w, h, fill = c.white, stroke = c.line, radius = 8, strokeWidth = 2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
const text = (x, y, value, size = 20, color = c.ink, weight = 400, anchor = 'start', extra = '') =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`
const line = (x1, y1, x2, y2, color = c.line, width = 2, dash = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
const path = (d, slug, color = c.blue, width = 3, dash = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#${slug}-arrow)" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
const pill = (x, y, w, value, fill = c.pale, color = c.navy) =>
  rect(x, y, w, 28, fill, 'none', 14, 0) + text(x + w / 2, y + 19, value, 14, color, 600, 'middle')
const card = (x, y, w, h, title, body = [], options = {}) => {
  const fill = options.fill ?? c.white
  const stroke = options.stroke ?? c.line
  const titleSize = options.titleSize ?? 23
  let s = rect(x, y, w, h, fill, stroke, 10, options.strokeWidth ?? 2)
  if (options.kicker) s += text(x + 24, y + 30, options.kicker.toUpperCase(), 14, options.kickerColor ?? c.red, 700, 'start', 'letter-spacing="1.4"')
  s += text(x + 24, y + (options.kicker ? 62 : 44), title, titleSize, c.navy, 700)
  body.forEach((entry, i) => { s += text(x + 24, y + (options.kicker ? 92 : 76) + i * 25, entry, 17, c.muted) })
  return s
}
const multi = (x, y, values, size = 18, color = c.muted, weight = 400, gap = 26) =>
  values.map((value, i) => text(x, y + i * gap, value, size, color, weight)).join('')
const panel = (slug, num, title, subtitle, body, footer) => {
  const titleId = `${slug}-title`
  const descId = `${slug}-desc`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${titleId} ${descId}">
<title id="${titleId}">${esc(title)}</title>
<desc id="${descId}">${esc(subtitle)} ${esc(footer)}</desc>
<defs><marker id="${slug}-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="${c.blue}"/></marker></defs>
${rect(0, 0, W, H, c.paper, c.paper, 0, 0)}
${rect(0, 0, W, 12, c.navy, c.navy, 0, 0)}
${text(72, 68, `RALLY POINT  /  TENANT-READY ARCHITECTURE  /  ${String(num).padStart(2, '0')}`, 17, c.red, 700, 'start', 'letter-spacing="1.8"')}
${text(72, 132, title, 44, c.navy, 700)}
${text(72, 178, subtitle, 21, c.muted)}
${body}
${line(72, 816, 1528, 816, c.line, 2)}
${text(72, 850, footer, 17, c.muted)}
${text(1528, 850, `${num} / 6`, 17, c.red, 700, 'end')}
</svg>`
}

function systemLayers() {
  const slug = '01-system-layers'
  const rows = [
    ['01  EXPERIENCE', ['Rally Point Club app', 'Member, assigned staff, club admin'], ['Public + platform channels', 'Club TV board; superadmin later']],
    ['02  INTERFACE', ['Role-specific React routes', 'Phone-first app and desktop console'], ['Fixed club context', 'Rally Point only; select venue as needed']],
    ['03  TRUSTED OPS', ['Atomic domain commands', 'Reservation, open play, checkout'], ['Platform controls (later)', 'Tenant setup, support sessions, CRM']],
    ['04  ACCESS', ['Supabase Auth', 'One Rally Point sign-in today'], ['Database authorization', 'club_id, venue grants, RLS + grants']],
    ['05  DATA', ['One active club', 'Venues, memberships, bookings, ledger'], ['Tenant-ready schema', 'club_id on owned records; future clubs']],
  ]
  let body = ''
  rows.forEach(([label, left, right], i) => {
    const y = 216 + i * 116
    body += rect(72, y, 1456, 104, c.white, c.line, 8, 2)
    body += rect(72, y, 240, 104, i === 2 ? c.redPale : c.pale, 'none', 8, 0)
    body += text(92, y + 58, label, 20, i === 2 ? c.red : c.navy, 700)
    body += text(344, y + 43, left[0], 23, c.navy, 700)
    body += text(344, y + 75, left[1], 17, c.muted)
    body += line(912, y + 22, 912, y + 82, c.line, 2)
    body += text(944, y + 43, right[0], 23, c.navy, 700)
    body += text(944, y + 75, right[1], 17, c.muted)
  })
  return panel(slug, 1, 'One club now, tenant-ready layers', 'The app serves Rally Point Club while the data model enforces club ownership.', body,
    'One active club context. Trusted services and database policies enforce access.')
}

function tenantModel() {
  const slug = '02-tenant-model'
  let body = ''
  // Zone backgrounds sit behind relationship strokes and cards.
  body += rect(72, 220, 328, 568, c.pale, c.line, 10, 2)
  body += rect(424, 220, 608, 568, c.white, c.line, 10, 2)
  body += rect(1056, 220, 472, 568, c.pale, c.line, 10, 2)
  body += path('M 376 364 H 412 Q 424 364 424 376 V 500 H 448', slug)
  body += path('M 1008 354 H 1080', slug)
  body += path('M 728 408 V 440', slug)
  body += path('M 864 408 V 440', slug)
  body += path('M 1292 408 V 440', slug)
  body += path('M 1292 572 V 604', slug)
  body += text(96, 262, 'GLOBAL IDENTITY', 18, c.red, 700, 'start', 'letter-spacing="1.2"')
  body += text(448, 262, 'CLUB / TENANT', 18, c.red, 700, 'start', 'letter-spacing="1.2"')
  body += text(1080, 262, 'VENUE / LOCATION', 18, c.red, 700, 'start', 'letter-spacing="1.2"')
  body += card(96, 296, 280, 136, 'User + profile', ['One club sign-in today', 'Player-owned contact details'], { titleSize: 22 })
  body += card(96, 476, 280, 136, 'Platform role', ['Superadmin is separate', 'Trusted provisioning only'], { titleSize: 22 })
  body += card(448, 296, 560, 112, 'Rally Point Club', ['One active tenant row; future clubs can be added'], { fill: c.redPale, stroke: c.red })
  body += card(448, 440, 260, 132, 'Membership', ['player_id + club_id', 'Plan, status, expiry'], { titleSize: 21 })
  body += card(732, 440, 276, 132, 'Club staff role', ['user_id + club_id', 'Admin or staff'], { titleSize: 21 })
  body += card(448, 604, 560, 136, 'Booking + participation', ['player_id + club_id + venue_id + resource_id', 'Club membership applies at every club venue.'], { titleSize: 22 })
  body += card(1080, 296, 424, 112, 'Venue', ['club_id; local schedule and rules'])
  body += card(1080, 440, 424, 132, 'Bookable resource', ['venue_id; court, field, or room', 'Atomic allocation prevents overlap.'], { titleSize: 22 })
  body += card(1080, 604, 424, 136, 'Staff venue grant', ['staff role + venue_id', 'Staff operate assigned venues only.'], { titleSize: 22 })
  return panel(slug, 2, 'One active club, scoped records', 'Membership belongs to Rally Point Club and applies at its venues.', body,
    'Tenant-owned rows carry club_id now; venue activity also carries venue_id.')
}

function accessMatrix() {
  const slug = '03-access-boundaries'
  const cols = [
    ['Own', 'profile'], ['Club', 'membership'], ['Venue', 'operations'],
    ['Club', 'settings'], ['Platform', 'CRM'], ['Published', 'board'],
  ]
  const rows = [
    ['Player', ['Own', 'Own club', 'Own booking', 'No access', 'No access', 'Read']],
    ['Venue staff', ['Own', 'Assigned', 'Assigned R/W', 'No access', 'No access', 'Read']],
    ['Club admin', ['Own', 'Club R/W', 'All venues R/W', 'Club R/W', 'No access', 'Read']],
    ['Superadmin*', ['Own', 'Support read', 'Support read', 'Provision', 'Platform R/W', 'Read']],
    ['Public', ['No access', 'No access', 'No access', 'No access', 'No access', 'Read only']],
  ]
  let body = ''
  body += rect(72, 224, 200, 88, c.navy, c.navy, 8, 0)
  body += text(172, 277, 'ACTOR', 18, c.white, 700, 'middle')
  cols.forEach(([a, b], i) => {
    const x = 284 + i * 208
    body += rect(x, 224, 196, 88, c.navy, c.navy, 8, 0)
    body += text(x + 98, 260, a, 19, c.white, 700, 'middle')
    body += text(x + 98, 286, b, 17, c.white, 400, 'middle')
  })
  rows.forEach(([role, cells], r) => {
    const y = 328 + r * 88
    body += rect(72, y, 200, 76, r === 3 ? c.redPale : c.pale, r === 3 ? c.red : c.line, 6, 2)
    body += text(92, y + 46, role, 21, r === 3 ? c.red : c.navy, 700)
    cells.forEach((value, i) => {
      const x = 284 + i * 208
      const focal = r === 3 && (i === 1 || i === 2)
      const denied = value === 'No access'
      body += rect(x, y, 196, 76, focal ? c.redPale : denied ? c.paper : c.white, focal ? c.red : c.line, 6, focal ? 3 : 2)
      body += text(x + 98, y + 46, value, 17, focal ? c.red : denied ? c.muted : c.navy, focal ? 700 : 500, 'middle')
    })
  })
  body += pill(72, 774, 230, 'RLS + grants', c.pale, c.navy)
  body += text(322, 794, '* Later phase: support read requires one club, a reason, and an expiring session.', 18, c.muted)
  return panel(slug, 3, 'Access is scoped at the database', 'A fixed Rally Point context in the UI never grants authority on its own.', body,
    'Enforce RLS and grants now; superadmin access activates later.')
}

function platformControl() {
  const slug = '04-platform-control'
  let body = ''
  body += pill(72, 208, 240, 'LATER PLATFORM PHASE', c.redPale, c.red)
  body += path('M 440 324 H 584', slug)
  body += path('M 1000 324 H 1144', slug)
  body += path('M 792 394 V 492', slug)
  body += path('M 1000 336 H 1052 Q 1064 336 1064 348 V 570 Q 1064 582 1076 582 H 1144', slug)
  body += path('M 584 572 H 440', slug)
  body += path('M 792 660 V 700', slug)
  body += card(80, 252, 360, 144, 'Superadmin portal', ['Separate platform role', 'Current and future club oversight'], { fill: c.pale })
  body += card(584, 252, 416, 144, 'Platform control service', ['Trusted club activation', 'Separate from club operations'], { fill: c.redPale, stroke: c.red })
  body += card(1144, 252, 376, 144, 'Club CRM', ['Club accounts and contacts', 'Onboarding + support cases'])
  body += card(80, 492, 360, 168, 'One-club read view', ['Rally Point support view first', 'Scoped to one club per session'], { fill: c.pale })
  body += card(584, 492, 416, 168, 'Support session gate', ['One club + reason + expiry', 'Read-only; no operational edits'], { stroke: c.red })
  body += card(1144, 492, 376, 168, 'Platform reports', ['Rally Point summary now', 'Per-club rollups when activated'])
  body += card(584, 700, 416, 88, 'Audit trail', ['Entry and support reads recorded'], { titleSize: 22 })
  return panel(slug, 4, 'Later phase: superadmin + CRM', 'Keep the platform control area separate from the Rally Point Club app.', body,
    'Activate with trusted club provisioning, scoped support reads, and an audit trail.')
}

function bookingFlow() {
  const slug = '05-booking-payment'
  const actors = [
    [164, 'Player'], [476, 'Web app'], [788, 'Booking command'],
    [1100, 'Club payment'], [1412, 'Postgres'],
  ]
  const messages = [
    [164, 476, 292, 'Select venue and court', 'call'],
    [476, 788, 348, 'Request expiring hold', 'call'],
    [788, 1412, 404, 'Authorize and reserve atomically', 'call'],
    [1412, 788, 460, 'Hold reference', 'return'],
    [788, 1100, 516, 'Create Rally Point checkout', 'call'],
    [164, 1100, 572, 'Complete payment', 'call'],
    [1100, 788, 628, 'Verified webhook', 'call'],
    [788, 1412, 684, 'Confirm once; write club ledger', 'call'],
    [788, 476, 740, 'Confirmed booking', 'return'],
  ]
  let body = ''
  actors.forEach(([x]) => { body += line(x, 260, x, 768, c.line, 2, '7 7') })
  messages.forEach(([from, to, y, label, kind], i) => {
    body += path(`M ${from} ${y} H ${to}`, slug, i === 8 ? c.red : c.blue, i === 8 ? 4 : 3, kind === 'return' ? '8 6' : '')
    const mid = (from + to) / 2
    const width = Math.max(180, label.length * 10 + 28)
    body += rect(mid - width / 2, y - 36, width, 29, c.paper, 'none', 3, 0)
    body += text(mid, y - 15, label, 18, i === 8 ? c.red : c.ink, i === 8 ? 700 : 500, 'middle')
  })
  actors.forEach(([x, label]) => {
    body += rect(x - 116, 204, 232, 56, label === 'Booking command' ? c.redPale : c.pale, label === 'Booking command' ? c.red : c.line, 8, 2)
    body += text(x, 240, label, 19, c.navy, 700, 'middle')
  })
  return panel(slug, 5, 'Confirm only after payment', 'Rally Point receives payment directly; a trusted webhook confirms the reservation.', body,
    'The payment account is keyed by club_id for future clubs; webhook retries cannot duplicate ledger writes.')
}

function migrationPath() {
  const slug = '06-migration-path'
  const steps = [
    ['01', 'Reconcile', ['Check target migration history', 'and current live schema.', 'Map Rally Point records.']],
    ['02', 'Backfill', ['Create Rally Point Club and', 'its venues. Link current records', 'without changing ownership.']],
    ['03', 'Enforce', ['Add club and venue keys,', 'matching foreign keys,', 'RLS, grants, and indexes.']],
    ['04', 'Move flows', ['Use trusted reservations,', 'club checkout, public board', 'and scoped support reads.']],
    ['05', 'Verify', ['Use two clubs in staging to', 'test denied access, payments', 'and concurrency before launch.']],
  ]
  let body = ''
  steps.forEach(([num, title, lines], i) => {
    const x = 72 + i * 294
    if (i < steps.length - 1) body += path(`M ${x + 280} 452 H ${x + 294}`, slug)
    body += rect(x, 270, 280, 364, c.white, i === 4 ? c.red : c.line, 10, i === 4 ? 3 : 2)
    body += pill(x + 24, 294, 58, num, i === 4 ? c.redPale : c.pale, i === 4 ? c.red : c.navy)
    body += text(x + 24, 382, title, 28, c.navy, 700)
    body += multi(x + 24, 438, lines, 18, c.muted, 400, 34)
  })
  body += rect(72, 684, 1456, 104, c.navy, c.navy, 8, 0)
  body += text(100, 726, 'RELEASE GATE', 18, c.white, 700, 'start', 'letter-spacing="1.4"')
  body += text(100, 760, 'Keep one active club until cross-club isolation, booking overlap, and payments pass in staging.', 20, c.white)
  return panel(slug, 6, 'Make Rally Point tenant-ready', 'Backfill one active club, then verify isolation in local and staging.', body,
    'The dated authorization migration in this repo is labelled local/staging only.')
}

const diagrams = [
  ['01-system-layers', systemLayers()],
  ['02-tenant-model', tenantModel()],
  ['03-access-boundaries', accessMatrix()],
  ['04-platform-control', platformControl()],
  ['05-booking-payment', bookingFlow()],
  ['06-migration-path', migrationPath()],
]

await mkdir(out, { recursive: true })
const css = `*{box-sizing:border-box}body{margin:0;background:#e8edf3;color:${c.ink};font-family:${font}}main{max-width:1680px;margin:auto;padding:40px 24px 80px}header{margin:0 0 32px;padding:12px 0 24px;border-bottom:2px solid ${c.navy}}h1{margin:0;font-size:44px;color:${c.navy}}header p{font-size:19px;color:${c.muted};max-width:960px}section{margin:0 0 36px;background:white;border:1px solid ${c.line};padding:12px}svg{display:block;width:100%;height:auto}footer{font-size:16px;color:${c.muted}}`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rally Point — tenant-ready architecture</title><style>${css}</style></head><body><main><header><h1>Rally Point — tenant-ready architecture</h1><p>One active Rally Point Club web application with a club-scoped data model prepared for future tenants. Membership belongs to the club and applies at its venues. The separate superadmin portal and club CRM are a later platform phase. These diagrams describe target architecture, not deployed behavior.</p></header>${diagrams.map(([, svg]) => `<section>${svg}</section>`).join('')}<footer>Source: repository architecture and PRD, client Figma UI/UX styles, and owner decisions in this conversation. Generated from generate.mjs.</footer></main></body></html>`
await writeFile(join(out, 'index.html'), html, 'utf8')
for (const [slug, svg] of diagrams) await writeFile(join(out, `${slug}.svg`), svg, 'utf8')
console.log(`Generated ${diagrams.length} SVGs and index.html in ${out}`)
