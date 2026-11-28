import { describe, expect, it } from 'vitest'
import { callName } from './clubFormat'

describe('callName', () => {
  it('uses the first name and skips a title the club typed in front of it', () => {
    expect(callName('Coach Marco Santos')).toBe('Marco')
    expect(callName('  coach.  Rica Villanueva ')).toBe('Rica')
    expect(callName('Ana Reyes')).toBe('Ana')
  })

  it('keeps a one-word name, even when it is a title', () => {
    expect(callName('Coach')).toBe('Coach')
    expect(callName('Marco')).toBe('Marco')
  })
})
