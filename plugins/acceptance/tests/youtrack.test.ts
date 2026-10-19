import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const FEATURE = 'Feature: Connexion\n  Scenario: mot de passe valide\n    Given un compte\n    When je me connecte\n    Then je vois le tableau de bord'
const RUN = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const YOUTRACK = { options: { tracker: 'youtrack', trackerUrl: 'https://acme.youtrack.cloud/', projects: 'CORE, GROWTH', token: 'secret' } }
const OK = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })

function base(on: On): void {
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 7 }))
}

describe('save_acceptance_criteria on YouTrack', () => {
  test('writes the rules locally and into the description of the branch ticket', YOUTRACK, async ($, on) => {
    base(on)
    const written: string[] = []
    const posted: { url: string; body: string; auth: string }[] = []
    on('process.run', () => RUN('feature/CORE-4\n'))
    on('fs.exists', () => ({ value: false }))
    on('fs.write', (_$, e) => {
      written.push(e.path)
      return { value: undefined }
    })
    on('http.fetch', (_$, e) => {
      if (e.init?.method === 'POST') posted.push({ url: e.url, body: e.init.body ?? '', auth: e.init.headers?.Authorization ?? '' })
      return OK({ description: 'Contexte' })
    })

    const ran = await $.tool.call({ tool: 'mcp__acceptance__save_acceptance_criteria', feature: FEATURE })

    expect(written.some(path => path.endsWith('.claude/acceptance/feature_CORE-4.feature'))).toBe(true)
    expect(posted[0]?.url).toBe('https://acme.youtrack.cloud/api/issues/CORE-4?fields=id')
    expect(posted[0]?.auth).toBe('Bearer secret')
    expect(posted[0]?.body.includes("## Règles d'acceptation")).toBe(true)
    expect(posted[0]?.body.includes('Scenario: mot de passe valide')).toBe(true)
    expect(JSON.stringify(ran)).toContain('CORE-4')
  })

  test('refuses a text without Feature and Scenario', YOUTRACK, async ($, on) => {
    base(on)
    on('process.run', () => RUN('main\n'))
    on('fs.exists', () => ({ value: false }))

    const ran = await $.tool.call({ tool: 'mcp__acceptance__save_acceptance_criteria', feature: 'faire le login' })

    expect('deny' in ran || ran.isError === true).toBe(true)
    expect(JSON.stringify(ran)).toContain('Feature:')
  })
})

describe('create_ticket on YouTrack', () => {
  test('resolves the project, creates the issue with context and rules, then switches to feature/<ID>', YOUTRACK, async ($, on) => {
    base(on)
    const argv: string[] = []
    let body = ''
    on('process.run', (_$, e) => {
      argv.push(e.argv.join(' '))
      if (e.argv.join(' ') === 'git branch --show-current') return RUN('claude/work\n')
      return e.argv[1] === 'rev-parse' ? RUN('', 1) : RUN('')
    })
    on('fs.exists', (_$, e) => ({ value: e.path.endsWith('claude_work.feature') }))
    on('fs.read', () => ({ value: FEATURE }))
    on('fs.write', () => ({ value: undefined }))
    on('http.fetch', (_$, e) => {
      if (e.url.includes('/api/admin/projects')) return OK([{ id: '0-1', shortName: 'CORE' }, { id: '0-2', shortName: 'GROWTH' }])
      body = e.init?.body ?? ''
      return OK({ idReadable: 'GROWTH-9' })
    })

    const ran = await $.tool.call({ tool: 'mcp__acceptance__create_ticket', project: 'GROWTH', summary: 'Connexion', context: 'Le pourquoi.' })

    expect(body.includes('"id":"0-2"')).toBe(true)
    expect(body.includes('Le pourquoi.') && body.includes('gherkin')).toBe(true)
    expect(argv.includes('git switch -c feature/GROWTH-9')).toBe(true)
    expect(JSON.stringify(ran)).toContain('https://acme.youtrack.cloud/issue/GROWTH-9')
  })

  test('refuses a project the tracker does not know', YOUTRACK, async ($, on) => {
    base(on)
    on('process.run', () => RUN('claude/work\n'))
    on('fs.exists', () => ({ value: false }))
    on('http.fetch', () => OK([{ id: '0-1', shortName: 'CORE' }]))

    const ran = await $.tool.call({ tool: 'mcp__acceptance__create_ticket', project: 'NOPE', summary: 'Connexion', context: 'Le pourquoi.' })

    expect('deny' in ran || ran.isError === true).toBe(true)
    expect(JSON.stringify(ran)).toContain('Projet introuvable')
  })
})

describe('branch guard on YouTrack', () => {
  test('refuses a branch created without a ticket number', YOUTRACK, async ($, on) => {
    base(on)
    on('process.run', () => RUN('main\n'))
    on('fs.exists', () => ({ value: false }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git switch -c feature/login' })

    expect('deny' in ran || ran.isError === true).toBe(true)
    expect(JSON.stringify(ran)).toContain('feature/CORE-42')
  })

  test('lets a branch named after its ticket through', YOUTRACK, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))

    const ran = await $.tool.call({ tool: 'Bash', command: 'git switch -c feature/CORE-4' })

    expect(ran.isError).toBeUndefined()
  })
})

describe('prompt context', () => {
  test('asks the final summary to list the ticket artifacts by name and link', YOUTRACK, async ($, on) => {
    base(on)
    const pages = JSON.stringify({ ticket: 'https://claude.ai/artifact/T', rules: 'https://claude.ai/artifact/R', proofs: 'https://claude.ai/artifact/P' })
    on('process.run', () => RUN('feature/CORE-25\n'))
    on('fs.exists', (_$, e) => ({ value: e.path.endsWith('.pages.json') }))
    on('fs.read', () => ({ value: pages }))
    on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

    const context = JSON.stringify(await $.prompt.submit({ text: 'ajoute le calendrier', wait: false } as never))

    expect(context).toContain('CORE-25 — Ticket : https://claude.ai/artifact/T')
    expect(context).toContain('CORE-25 — Règles : https://claude.ai/artifact/R')
    expect(context).toContain('CORE-25 — Preuves : https://claude.ai/artifact/P')
    expect(context).toContain("l'un des projets CORE, GROWTH")
  })

  test('without configuration, the context asks to set the tracker up', async ($, on) => {
    base(on)
    on('process.run', () => RUN('main\n'))
    on('fs.exists', () => ({ value: false }))
    on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

    const context = JSON.stringify(await $.prompt.submit({ text: 'ajoute le calendrier', wait: false } as never))

    expect(context).toContain("n'est pas configuré")
  })
})
