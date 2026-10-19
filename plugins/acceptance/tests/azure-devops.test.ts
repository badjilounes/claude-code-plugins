import type { On } from 'claude-code'
import { describe, expect } from 'claude-code/testing'

import { withSettings as test } from './settings'

const FEATURE = 'Feature: Connexion\n  Scenario: mot de passe valide\n    Given un compte <admin>\n    Then je vois le tableau de bord'
const RUN = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const OK = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
const AZURE = { options: { tracker: 'azure-devops', trackerUrl: 'https://dev.azure.com/acme', azureProject: 'Web Shop', token: 'pat' } }
const BASIC = `Basic ${btoa(':pat')}`
const API = 'https://dev.azure.com/acme/Web%20Shop/_apis/wit'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type Call = { method: string; url: string; body: string; auth: string; type: string }

function recorder(on: On, answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = []
  on('http.fetch', (_$, e) => {
    const call = { method: e.init?.method ?? 'GET', url: e.url, body: e.init?.body ?? '', auth: e.init?.headers?.Authorization ?? '', type: e.init?.headers?.['Content-Type'] ?? '' }
    calls.push(call)
    return OK(answer(call))
  })

  return calls
}

function base(on: On): void {
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 7 }))
}

describe('create_ticket on Azure DevOps', () => {
  test('creates a work item of the configured type with HTML context and rules, then switches to feature/<ID>', AZURE, async ($, on) => {
    base(on)
    const argv: string[] = []
    on('process.run', (_$, e) => {
      argv.push(e.argv.join(' '))
      if (e.argv.join(' ') === 'git branch --show-current') return RUN('claude/work\n')
      return e.argv[1] === 'rev-parse' ? RUN('', 1) : RUN('')
    })
    on('fs.exists', (_$, e) => ({ value: e.path.endsWith('claude_work.feature') }))
    on('fs.read', () => ({ value: FEATURE }))
    on('fs.write', () => ({ value: undefined }))
    const calls = recorder(on, () => ({ id: 1234 }))

    const ran = await $.tool.call({ tool: 'mcp__acceptance__create_ticket', summary: 'Connexion', context: 'Le **pourquoi**.\n\n- un\n- deux' })
    const create = calls[0]
    const patch = JSON.parse(create?.body ?? '[]') as { path: string; value: string }[]

    expect(create?.url).toBe(`${API}/workitems/$User%20Story?api-version=7.1`)
    expect(create?.auth).toBe(BASIC)
    expect(create?.type).toBe('application/json-patch+json')
    expect(patch.find(one => one.path === '/fields/System.Title')?.value).toBe('Connexion')
    const description = patch.find(one => one.path === '/fields/System.Description')?.value ?? ''
    expect(description).toContain('<ul><li>un</li><li>deux</li></ul>')
    expect(description).toContain("<h2>Règles d'acceptation</h2><pre>Feature: Connexion")
    expect(description).toContain('un compte &lt;admin&gt;')
    expect(argv.includes('git switch -c feature/1234')).toBe(true)
    expect(JSON.stringify(ran)).toContain('#1234')
    expect(JSON.stringify(ran)).toContain('https://dev.azure.com/acme/Web%20Shop/_workitems/edit/1234')
  })
})

describe('save_acceptance_criteria on Azure DevOps', () => {
  test('replaces the rules block of the work item description, keeping the rest', AZURE, async ($, on) => {
    base(on)
    on('process.run', () => RUN('feature/1234-login\n'))
    on('fs.exists', () => ({ value: false }))
    on('fs.write', () => ({ value: undefined }))
    const calls = recorder(on, () => ({ fields: { 'System.Description': "<p>Contexte</p><h2>Règles d'acceptation</h2><pre>Feature: Ancien</pre>" } }))

    const ran = await $.tool.call({ tool: 'mcp__acceptance__save_acceptance_criteria', feature: FEATURE })
    const patch = calls.find(call => call.method === 'PATCH')
    const value = (JSON.parse(patch?.body ?? '[]') as { value: string }[])[0]?.value ?? ''

    expect(patch?.url).toBe(`${API}/workitems/1234?api-version=7.1`)
    expect(value.startsWith('<p>Contexte</p>')).toBe(true)
    expect(value).not.toContain('Ancien')
    expect(value).toContain('Scenario: mot de passe valide')
    expect(JSON.stringify(ran)).toContain('#1234')
  })
})

describe('branch guard on Azure DevOps', () => {
  test('refuses a branch without a work item number', AZURE, async ($, on) => {
    base(on)
    on('process.run', () => RUN('main\n'))
    on('fs.exists', () => ({ value: false }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git checkout -b feature/login' })

    expect('deny' in ran || ran.isError === true).toBe(true)
    expect(JSON.stringify(ran)).toContain('feature/1234')
  })

  test('lets feature/<number> through', AZURE, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))

    const ran = await $.tool.call({ tool: 'Bash', command: 'git checkout -b feature/1234-login' })

    expect(ran.isError).toBeUndefined()
  })
})

describe('proofs on Azure DevOps', () => {
  test('a proof goes to the work item as a Markdown comment that a session on that branch reads back', AZURE, async ($, on) => {
    base(on)
    const files = new Map<string, string>()
    let branch = 'feature/1234'
    on('process.run', (_$, e) => {
      if (e.argv.join(' ') === 'git branch --show-current') return RUN(`${branch}\n`)
      return e.argv[0] === 'curl' ? RUN(JSON.stringify({ url: `${API}/attachments/abc` })) : RUN('')
    })
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
    on('fs.write', (_$, e) => {
      files.set(e.path, e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
    let comment = ''
    const calls = recorder(on, call => {
      if (call.method === 'POST' && call.url.includes('/comments')) comment = (JSON.parse(call.body) as { text: string }).text
      if (call.url.includes('/comments')) return { comments: comment === '' ? [] : [{ text: comment }] }
      return { fields: { 'System.Title': 'Connexion', 'System.Description': '<p>Ctx</p>' }, relations: [] }
    })

    await $.tool.call({ tool: 'mcp__acceptance__add_evidence', kind: 'curl', title: 'API — Santé', subtitle: 'service disponible', detail: '$ curl /health\n\n200 OK' })
    const post = calls.find(call => call.method === 'POST' && call.url.includes('/comments'))

    expect(post?.url).toBe(`${API}/workItems/1234/comments?format=markdown&api-version=7.1-preview.4`)
    expect(comment).toContain('acceptance-proof:')
    expect(comment).toContain('200 OK')
    expect(calls.some(call => call.method === 'PATCH' && call.body.includes('AttachedFile') && call.body.includes(`${API}/attachments/abc`))).toBe(true)

    files.clear()
    branch = 'main'
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    branch = 'feature/1234'
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })

    expect((await ui.find({ key: 'proofs' }))?.text).toBe('Preuves 1')
    await ui.unmount()
  })
})
