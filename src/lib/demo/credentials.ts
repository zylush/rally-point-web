const seededDemoPasswords = new Map<string, string>([
  ['admin@rallypoint.local', 'admin123'],
  ['staff@rallypoint.local', 'staff123'],
  ['member@rallypoint.local', 'member123'],
])

let demoPasswords = new Map(seededDemoPasswords)

export function resetDemoPasswords() {
  demoPasswords = new Map(seededDemoPasswords)
}

export function normalizeDemoEmail(email: string) {
  return email.trim().toLowerCase()
}

export function getDemoPassword(email: string) {
  return demoPasswords.get(email)
}

export function hasDemoPassword(email: string) {
  return demoPasswords.has(email)
}

export function setDemoPassword(email: string, password: string) {
  demoPasswords = new Map(demoPasswords).set(email, password)
}
