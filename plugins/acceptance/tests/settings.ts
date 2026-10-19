import type { On } from 'claude-code'
import { test as base } from 'claude-code/testing'

type Fixture = { options: Record<string, unknown> }
type Body = Parameters<typeof base>[2]
type Hook = (...args: unknown[]) => unknown

const FILE = '.claude/acceptance.json'

export function withSettings(name: string, fixture: Fixture | Body, body?: Body): void {
  if (body === undefined) return base(name, fixture as Body)
  const { token, ...settings } = (fixture as Fixture).options
  if (settings.trackerUrl === undefined) return base(name, fixture as Fixture, body)
  const served: Record<string, unknown> = { 'fs.exists': true, 'fs.read': JSON.stringify(settings) }

  return base(name, { options: { token } }, async ($, on) => {
    const own = new Map<string, Hook>()
    for (const event of Object.keys(served)) {
      ;(on as Hook)(event, (...args: unknown[]) => {
        if (String((args[1] as { path: string }).path).endsWith(FILE)) return { value: served[event] }
        const hook = own.get(event)
        return hook === undefined ? (args[2] as Hook)(args[1]) : hook(...args)
      })
    }
    if (typeof settings.trackerUrl === 'string') {
      const origin = new URL(settings.trackerUrl).origin
      ;(on as Hook)('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key === 'approvedOrigins' ? [origin] : undefined }))
    }
    const layered = ((event: string, ...rest: unknown[]) => (event in served ? own.set(event, rest[rest.length - 1] as Hook) : (on as Hook)(event, ...rest))) as On

    return body($, layered)
  })
}
