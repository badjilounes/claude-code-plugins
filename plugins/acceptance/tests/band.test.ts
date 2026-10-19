import type { On } from 'claude-code'
import { describe, expect } from 'claude-code/testing'

import { withSettings as test } from './settings'

const RUN = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const YOUTRACK = { options: { tracker: 'youtrack', trackerUrl: 'https://acme.youtrack.cloud', projects: 'CORE', token: 'secret' } }
const PANE = { surface: 'desktop', component: 'Pane', props: { title: 'x', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

function workspace(on: On, branch: string, seed: Record<string, string>, extra: (line: string, stdin: string) => ReturnType<typeof RUN> | undefined = () => undefined, home?: string) {
  const files = new Map<string, string>(Object.entries(seed))
  const key = (path: string) => [...files.keys()].find(one => path.endsWith(one)) ?? path
  on('clock.now', () => ({ value: 1 }))
  on('env.get', () => ({ value: home }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => {
    const line = e.argv.join(' ')
    if (line === 'git branch --show-current') return RUN(`${branch}\n`)
    return extra(line, e.init?.stdin ?? '') ?? RUN('')
  })
  on('fs.exists', (_$, e) => ({ value: files.has(key(e.path)) }))
  on('fs.read', (_$, e) => ({ value: files.get(key(e.path)) ?? '' }))
  on('fs.write', (_$, e) => {
    files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '200 OK', stderr: '', interrupted: false } }))

  return files
}

describe('band above the prompt', () => {
  test('shows Ticket, Règles and Preuves as native artifact links, without a branch chip', async ($, on) => {
    const opened: string[] = []
    on('tool.call', { tool: 'Artifact' }, (_$, e) => {
      opened.push(`${String(e.action)} ${String(e.url)}`)
      return { result: 'ok' }
    })
    const pages = JSON.stringify({ ticket: 'https://claude.ai/artifact/T', rules: 'https://claude.ai/artifact/R', proofs: 'https://claude.ai/artifact/P' })
    workspace(on, 'feature/CORE-42-login', {
      '.claude/acceptance/feature_CORE-42-login.feature': 'Feature: F\n  Scenario: ok\n  Scenario: ko\n',
      '.claude/acceptance/feature_CORE-42-login.pages.json': pages,
    })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })

    const marks = (await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))
    expect(marks).toContain('[Ticket CORE-42](https://claude.ai/artifact/T)')
    expect(marks).toContain('[Règles 0/2](https://claude.ai/artifact/R)')
    expect(await ui.find({ key: 'branch' })).toBeUndefined()
    expect(opened).toEqual([])
    await ui.unmount()
  })

  test('hides everything without ticket, rules or proofs', async ($, on) => {
    workspace(on, 'main', {})

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const drawn = await $.ui.mount({ plugin: 'acceptance', surface: 'terminal', ...BAND }).then(() => 'drawn by the mod', (error: unknown) => String(error))

    expect(drawn).toContain('no implementation for ui.render')
  })
})

describe('recovery from the ticket', () => {
  test('a session reads rules and proofs back from the ticket named by the branch', YOUTRACK, async ($, on) => {
    const comment = `**Preuve** · curl · health\n\n\`acceptance-proof:${btoa(JSON.stringify({ id: '5', kind: 'curl', title: 'health', detail: '200 OK', file: '', at: 5 })).replace(/=+$/, '')}\``
    const issue = { summary: 'Login', description: "Ctx\n\n## Règles d'acceptation\n\n```gherkin\nFeature: L\n  Scenario: ok\n    Given a\n```", comments: [{ text: comment }], attachments: [] }
    const urls: string[] = []
    workspace(on, 'feature/CORE-4', {})
    on('http.fetch', (_$, e) => {
      urls.push(e.url)
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(issue) } }
    })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })

    expect(urls.some(url => url.startsWith('https://acme.youtrack.cloud/api/issues/CORE-4?'))).toBe(true)
    expect((await ui.find({ key: 'rules' }))?.text).toBe('Règles 0/1')
    expect((await ui.find({ key: 'proofs' }))?.text).toBe('Preuves 1')
    await ui.unmount()
  })

  test('a proof written before the marker format changed is still read back', YOUTRACK, async ($, on) => {
    const comment = '**Preuve** · curl · health\n\n<!-- acceptance-proof:{"id":"5","kind":"curl","title":"health","detail":"200 OK","file":"","at":5} -->'
    const issue = { summary: 'Login', description: 'Ctx', comments: [{ text: comment }], attachments: [] }
    workspace(on, 'feature/CORE-4', {})
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(issue) } }))

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })

    expect((await ui.find({ key: 'proofs' }))?.text).toBe('Preuves 1')
    await ui.unmount()
  })
})

describe('untrusted ticket comments', () => {
  test('a proof whose file name escapes the proofs folder or whose url leaves the tracker is never downloaded, a genuine attachment still is', YOUTRACK, async ($, on) => {
    const marker = (value: unknown) => `\`acceptance-proof:${btoa(JSON.stringify(value)).replace(/=+$/, '')}\``
    const comments = [
      { text: marker({ id: '1', kind: 'capture', title: 'a', file: '../../../.zshrc', at: 1 }) },
      { text: marker({ id: '2', kind: 'capture', title: 'b', file: 'shot.png', at: 2 }) },
      { text: marker({ id: '"><x>', kind: 'curl', title: 'c', at: 3 }) },
      { text: marker({ id: '4', kind: 'capture', title: 'd', file: '4-ok.png', at: 4 }) },
    ]
    const issue = { summary: 'S', description: '', comments, attachments: [{ name: '../../../.zshrc', url: '/api/files/1' }, { name: 'shot.png', url: 'https://evil.example/shot.png' }, { name: '4-ok.png', url: '/api/files/2?sign=s' }] }
    const curls: string[] = []
    workspace(on, 'feature/CORE-4', {}, (line, stdin) => {
      if (line.startsWith('curl')) curls.push(stdin)
      return undefined
    })
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(issue) } }))

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })

    expect(curls.length).toBe(1)
    expect(curls[0]).toContain('url = "https://acme.youtrack.cloud/api/files/2?sign=s"')
    expect(curls[0]).toContain('output = "/repo/.claude/acceptance/feature_CORE-4/proofs/4-ok.png"')
    expect((await ui.find({ key: 'proofs' }))?.text).toBe('Preuves 3')
    await ui.unmount()
  })
})

describe('panes', () => {
  test('rules list scenarios by subject, foldable, with links to their proofs', async ($, on) => {
    const rules = 'Feature: Calendrier\n  Rule: Calendrier vide\n    Scenario: aucun post\n      Given rien\n  Rule: Jour chargé\n    Scenario: deux posts\n      Given deux posts\n'
    const published: string[] = []
    on('tool.call', { tool: 'Artifact' }, (_$, e) => {
      published.push(String(e.file_path))
      return { result: 'Published https://claude.ai/artifact/PAGE1' }
    })
    workspace(on, 'feature/CORE-4', { '.claude/acceptance/feature_CORE-4.feature': rules })

    await $.tool.call({ tool: 'mcp__acceptance__add_evidence', kind: 'curl', title: 'API', subtitle: 'santé', scenario: 'aucun post', detail: '$ curl /health\n\n200 OK' })
    const ui = await $.ui.mount({ plugin: 'acceptance', requestId: 'acceptance-rules', ...PANE })
    const marks = async () => (await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))

    expect(await marks()).toContain('✓ **aucun post**  \n  *Given* rien')
    expect(published).toEqual([])
    expect(await marks()).toContain('[santé](file:///repo/.claude/acceptance/feature_CORE-4/proofs/1-api-sante.txt)')
    expect((await marks()).some(text => text.startsWith('○ **deux posts**') && text.includes('_En attente de preuve_'))).toBe(true)
    await ui.press({ key: 'subject-Jour chargé' })
    expect((await marks()).some(text => text.includes('deux posts'))).toBe(false)
    await ui.unmount()
  })

  test('a text proof is a .txt file shown in native Code', async ($, on) => {
    const files = workspace(on, 'feature/CORE-4', {})

    await $.tool.call({ tool: 'mcp__acceptance__add_evidence', kind: 'curl', title: 'API — Santé', subtitle: 'service disponible', detail: '$ curl /health\n\n200 OK' })
    const ui = await $.ui.mount({ plugin: 'acceptance', requestId: 'acceptance-proofs', ...PANE })
    const txt = [...files.keys()].find(path => path.endsWith('.txt')) ?? ''

    expect(txt).toBe('/repo/.claude/acceptance/feature_CORE-4/proofs/1-api-sante-service-disponible.txt')
    expect((await ui.find({ type: 'Code' }))?.props.source).toContain('200 OK')
    expect((await ui.find({ key: 'open-1' }))?.props.text).toBe(`[service disponible](file://${txt})`)
    expect(await ui.find({ key: 'goto-rule-1' })).toBeUndefined()
    await ui.unmount()
  })

  test('an artifact is a native artifact link, never a file', YOUTRACK, async ($, on) => {
    const files = workspace(on, 'feature/CORE-4', {})

    await $.tool.call({ tool: 'mcp__acceptance__add_evidence', kind: 'artifact', title: 'Revue', subtitle: 'Maquette calendrier', scenario: 'calendrier vide', detail: 'https://claude.ai/artifact/abc' })
    const ui = await $.ui.mount({ plugin: 'acceptance', requestId: 'acceptance-proofs', ...PANE })

    expect([...files.keys()].some(path => path.endsWith('.txt'))).toBe(false)
    expect((await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))).toContain('[§ calendrier vide](https://acme.youtrack.cloud/issue/CORE-4)')
    expect((await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))).toContain('[Maquette calendrier](https://claude.ai/artifact/abc)')
    await ui.unmount()
  })
})

describe('automatic capture', () => {
  test('an update of an existing artifact is not a new proof', async ($, on) => {
    const files = workspace(on, 'feature/CORE-4', {})
    on('tool.call', { tool: 'Artifact' }, () => ({ result: 'Updated the Artifact at https://claude.ai/artifact/abc (Version 2)' }))

    await $.tool.call({ tool: 'Artifact', url: 'https://claude.ai/artifact/abc', file_path: '/tmp/page.html' })

    expect([...files.keys()].filter(path => path.endsWith('.evidence.json'))).toEqual([])
  })

  test('a script that only mentions a test runner is not a test proof', async ($, on) => {
    const files = workspace(on, 'feature/CORE-4', {})

    await $.tool.call({ tool: 'Bash', command: "python3 - <<'EOF'\nprint('nx test feature-calendar-page')\nEOF" })

    expect([...files.keys()].filter(path => path.endsWith('.evidence.json'))).toEqual([])
  })
})

describe('band fallback', () => {
  test('before its artifact is published, a button opens the pane instead', async ($, on) => {
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    workspace(on, 'feature/CORE-4', { '.claude/acceptance/feature_CORE-4.feature': 'Feature: F\n  Scenario: ok\n' })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ plugin: 'acceptance', surface: 'desktop', ...BAND })
    await ui.press({ key: 'rules' })

    expect(opened).toEqual(['acceptance-rules'])
    await ui.unmount()
  })
})
