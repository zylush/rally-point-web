const seededDemoPasswords = new Map<string, string>([
  ['superadmin@brinely.info', 'superadmin123'],
  ['admin@brinely.info', 'admin123'],
  ['staff@brinely.info', 'staff123'],
  ['member@brinely.info', 'member123'],
  ['davao.admin@brinely.info', 'davao123'],
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
