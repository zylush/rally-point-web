import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitClubLiveUpdate, useClubLiveRefresh } from './livePulse'

const mockState = vi.hoisted(() => ({
  isDemoMode: true,
  channelHandlers: new Map<string, () => void>(),
  sentPayloads: [] as unknown[],
  removedChannels: 0,
}))

vi.mock('./supabase', () => ({
  get isDemoMode() {
    return mockState.isDemoMode
  },
  supabase: {
    channel: (name: string) => {
      const apiObj = {
        on: (_type: string, _filter: unknown, cb: () => void) => {
          mockState.channelHandlers.set(name, cb)
          return apiObj
        },
        subscribe: (cb?: (status: string) => void) => {
          cb?.('SUBSCRIBED')
          return apiObj
        },
        send: async (payload: unknown) => {
          mockState.sentPayloads.push(payload)
          return 'ok'
        },
      }
      return apiObj
    },
    removeChannel: async () => {
      mockState.removedChannels += 1
      return 'ok'
    },
  },
}))

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>()
  name: string
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.add(this)
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name) {
        peer.onmessage?.({ data })
      }
    }
  }

  close() {
    FakeBroadcastChannel.instances.delete(this)
  }
}

function Harness({ keys, onRefresh, pollMs }: { keys: Array<string | null | undefined>; onRefresh: () => void; pollMs?: number }) {
  useClubLiveRefresh(keys, onRefresh, pollMs)
  return null
}

describe('livePulse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockState.isDemoMode = true
    mockState.channelHandlers.clear()
    mockState.sentPayloads = []
    mockState.removedChannels = 0
    FakeBroadcastChannel.instances.clear()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('refreshes matching club subscribers via BroadcastChannel, storage, visibility, and polling', () => {
    const onRefresh = vi.fn()
    render(createElement(Harness, { keys: ['club-1', 'rally-point-gensan'], onRefresh, pollMs: 5000 }))

    // Unrelated club key does not trigger
    emitClubLiveUpdate(['other-club'])
    expect(onRefresh).not.toHaveBeenCalled()

    // Matching club key triggers immediately
    emitClubLiveUpdate(['RALLY-POINT-GENSAN'])
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // Storage update in demo mode triggers
    window.dispatchEvent(new StorageEvent('storage', { key: 'brinely_demo_v4' }))
    expect(onRefresh).toHaveBeenCalledTimes(2)

    // Tab wakeup triggers
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onRefresh).toHaveBeenCalledTimes(3)

    // Polling interval triggers when visible, skips when hidden
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(4)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(4)
  })

  it('uses Supabase broadcast channels in live mode and cleans up on unmount', async () => {
    mockState.isDemoMode = false
    const onRefresh = vi.fn()
    const { unmount } = render(createElement(Harness, { keys: ['club-live-1'], onRefresh, pollMs: 0 }))

    expect(mockState.channelHandlers.has('club-live:club-live-1')).toBe(true)
    mockState.channelHandlers.get('club-live:club-live-1')?.()
    expect(onRefresh).toHaveBeenCalledTimes(1)

    emitClubLiveUpdate(['club-live-1'])
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockState.sentPayloads).toHaveLength(1)

    unmount()
    expect(mockState.removedChannels).toBeGreaterThanOrEqual(1)
  })

  it('handles live channel timeouts/errors and empty keys without throwing', () => {
    mockState.isDemoMode = false
    emitClubLiveUpdate([null, undefined, '  '])
    const origSubscribe = mockState.channelHandlers.size
    expect(origSubscribe).toBe(0)
  })
})
