import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { gateProblem, isDone, moduleOf, nextSteps, parseWorkflow, render, roundedMinutes, billableMinutes, templateErrors, emptyProgress } from '../hooks/workflow'
import type { Progress, Workflow } from '../hooks/workflow'

const RUN = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const OK = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })

const WORKFLOW = {
  version: 1,
  tracker: { states: { active: 'In Progress', closed: 'Done', done: { Bug: 'Fixed', 'User Story': 'Testable' } }, subtask: { type: 'Task' }, fields: { estimate: 'Estimation' } },
  modules: { 'back-end': ['apps/*-api/**', 'libs/**/api/**'], 'front-end': ['apps/*-web/**'] },
  steps: [
    { id: 'take', do: ['assign-ticket', 'set-ticket-state:active'] },
    { id: 'plan', do: ['create-subtasks', 'estimate-subtasks'], requires: ['take'] },
    { id: 'work', repeat: 'per-subtask', do: ['assign-subtask', 'set-subtask-state:active'], requires: ['plan'] },
    { id: 'finish', repeat: 'per-subtask', do: ['log-time', 'set-subtask-state:closed'], requires: ['work'] },
    { id: 'pull-request', do: ['open-pr:pullRequest'], requires: ['finish:all'] },
    { id: 'hand-over', do: ['set-ticket-state:done'], requires: ['pull-request'] },
  ],
  gates: { edit: 'work', commit: 'work', pullRequest: 'finish:all' },
  time: { round: 15 },
  templates: { pullRequest: '.claude/acceptance-templates/pull-request.md' },
}

function parsed(raw: unknown = WORKFLOW): Workflow {
  const { workflow, errors } = parseWorkflow(raw)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return workflow
}

const TICKET = 'CORE-4'

function progress(patch: Partial<Progress>): Progress {
  return { ...emptyProgress(TICKET), ...patch }
}

const BACK = { module: 'back-end', id: 'CORE-5', title: 'API', estimate: 60, startedAt: 0, spent: 0, closed: false }

describe('workflow file', () => {
  test('a complete workflow parses without errors', async () => {
    expect(parseWorkflow(WORKFLOW).errors).toEqual([])
  })

  test('names every mistake: unknown action, unknown step, sub-task action outside a per-subtask step, template outside its folder', async () => {
    const { errors } = parseWorkflow({
      ...WORKFLOW,
      steps: [
        { id: 'take', do: ['assign-ticket', 'teleport'] },
        { id: 'work', do: ['log-time'], requires: ['nowhere'] },
      ],
      gates: { edit: 'ghost' },
      templates: { pullRequest: '../secrets.md' },
    })

    expect(errors.some(one => one.includes('action inconnue « teleport »'))).toBe(true)
    expect(errors.some(one => one.includes('étape inconnue « nowhere »'))).toBe(true)
    expect(errors.some(one => one.includes('log-time agit sur une sous-tâche'))).toBe(true)
    expect(errors.some(one => one.includes('gates.edit cite une étape inconnue « ghost »'))).toBe(true)
    expect(errors.some(one => one.includes('templates.pullRequest doit être sous .claude/acceptance-templates/'))).toBe(true)
  })

  test('a template may only use the known placeholders', async () => {
    expect(templateErrors('pr', '{{ticket.id}} {{subtasks}} {{secret}}')).toEqual(['template pr : variable inconnue {{secret}}'])
    expect(render('## {{ ticket.id }} — {{notes}}', { 'ticket.id': 'CORE-4', notes: 'ok' })).toBe('## CORE-4 — ok')
  })

  test('an edited path belongs to the module whose glob matches it', async () => {
    const workflow = parsed()

    expect(moduleOf(workflow, 'apps/sophia-api/src/main.ts')).toBe('back-end')
    expect(moduleOf(workflow, 'libs/sophia/publication/api/src/index.ts')).toBe('back-end')
    expect(moduleOf(workflow, 'apps/sophia-web/app/page.tsx')).toBe('front-end')
    expect(moduleOf(workflow, 'README.md')).toBe('')
  })
})

describe('workflow progress', () => {
  test('editing a module needs its sub-task taken, and the gate names the next step', async () => {
    const workflow = parsed()
    const planned = progress({ done: ['take', 'plan'], subtasks: [BACK] })

    expect(gateProblem(workflow, progress({ done: ['take'] }), 'edit', 'back-end')).toContain('aucune sous-tâche ouverte')
    expect(gateProblem(workflow, planned, 'edit', 'back-end')).toContain('lance l\'étape « work »')
    expect(nextSteps(workflow, planned)).toEqual(['work (back-end)'])
    expect(gateProblem(workflow, { ...planned, done: [...planned.done, 'work@CORE-5'] }, 'edit', 'back-end')).toBe('')
  })

  test('a pull request waits for every sub-task to be finished', async () => {
    const workflow = parsed()
    const front = { ...BACK, module: 'front-end', id: 'CORE-6' }
    const state = progress({ done: ['take', 'plan', 'work@CORE-5', 'finish@CORE-5', 'work@CORE-6'], subtasks: [{ ...BACK, closed: true }, front] })

    expect(gateProblem(workflow, state, 'pullRequest', '')).toContain('« finish:all »')
    expect(isDone(workflow, { ...state, done: [...state.done, 'finish@CORE-6'] }, 'finish:all', undefined)).toBe(true)
  })

  test('a re-opened ticket is worked through a new sub-task: the closed one does not count', async () => {
    const workflow = parsed()
    const reopened = progress({ done: ['take', 'plan', 'work@CORE-5', 'finish@CORE-5'], subtasks: [{ ...BACK, closed: true }] })

    expect(gateProblem(workflow, reopened, 'edit', 'back-end')).toContain('crée-la avec l\'étape de planification')
  })

  test('time is rounded up to the configured unit, and billable time never replaces the real time', async () => {
    expect(roundedMinutes(7 * 60000, 15)).toBe(15)
    expect(roundedMinutes(61 * 60000, 15)).toBe(75)
    expect(billableMinutes(30, 60)).toBe(60)
    expect(billableMinutes(90, 60)).toBe(90)
  })
})

type Call = { method: string; url: string; body: unknown; auth: string }

function repository(on: On, branch: string, files: Map<string, string>, answer: (call: Call) => unknown, now = { at: 1_000_000 }): Call[] {
  const calls: Call[] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: now.at }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const line = e.argv.join(' ')
    if (line === 'git branch --show-current') return RUN(`${branch}\n`)
    if (line === 'git rev-parse --show-toplevel') return RUN('/repo\n')
    return RUN('')
  })
  const key = (path: string) => (path.startsWith('/') ? path : `/repo/${path}`)
  on('fs.exists', (_$, e) => ({ value: files.has(key(e.path)) }))
  on('fs.read', (_$, e) => ({ value: files.get(key(e.path)) ?? '' }))
  on('fs.write', (_$, e) => {
    files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('http.fetch', (_$, e) => {
    const call = { method: e.init?.method ?? 'GET', url: e.url, body: e.init?.body === undefined ? undefined : JSON.parse(e.init.body), auth: e.init?.headers?.Authorization ?? '' }
    calls.push(call)
    return OK(answer(call))
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  return calls
}

const YOUTRACK = { options: { token: 'https://acme.youtrack.cloud secret' } }
const YOUTRACK_SETTINGS = JSON.stringify({ tracker: 'youtrack', trackerUrl: 'https://acme.youtrack.cloud', projects: 'CORE' })

function files(settings: string, workflow: unknown = WORKFLOW): Map<string, string> {
  return new Map([
    ['/repo/.claude/acceptance.json', settings],
    ['/repo/.claude/acceptance-workflow.json', JSON.stringify(workflow)],
    ['/repo/.claude/acceptance-templates/pull-request.md', '## {{ticket.id}} — {{ticket.title}}\n\n{{subtasks}}\n\n{{notes}}'],
  ])
}

function youtrackAnswer(assignee = ''): (call: Call) => unknown {
  return call => {
    if (call.url.includes('/api/users/me')) return { login: 'alice', fullName: 'Alice' }
    if (call.url.includes('fields=idReadable,summary,project(id)')) return { idReadable: TICKET, summary: 'Calendrier', project: { id: '0-1' }, customFields: [{ name: 'Type', value: { name: 'User Story' } }, { name: 'Assignee', value: assignee === '' ? null : { login: assignee } }] }
    if (call.method === 'POST' && call.url.includes('/api/issues?fields=idReadable')) return { idReadable: 'CORE-5' }
    return {}
  }
}

describe('workflow_step on YouTrack', () => {
  test('take assigns the ticket to me and moves it to the active state', YOUTRACK, async ($, on) => {
    const calls = repository(on, `feature/${TICKET}`, files(YOUTRACK_SETTINGS), youtrackAnswer())

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'take' }))

    const updates = calls.filter(one => one.method === 'POST' && one.url.startsWith(`https://acme.youtrack.cloud/api/issues/${TICKET}?`))
    expect(updates.map(one => JSON.stringify(one.body))).toEqual([
      JSON.stringify({ customFields: [{ name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: 'alice' } }] }),
      JSON.stringify({ customFields: [{ name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } }] }),
    ])
    expect(calls.every(one => one.auth === 'Bearer secret')).toBe(true)
    expect(ran).toContain('Prochaine étape : plan')
  })

  test('a ticket someone else holds stays theirs: I work through my own sub-tasks', YOUTRACK, async ($, on) => {
    const calls = repository(on, `feature/${TICKET}`, files(YOUTRACK_SETTINGS), youtrackAnswer('bob'))

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'take' }))

    expect(calls.some(one => JSON.stringify(one.body ?? '').includes('SingleUserIssueCustomField'))).toBe(false)
    expect(ran).toContain('reste assigné à bob')
  })

  test('a step whose requirements are not met is refused and names what comes first', YOUTRACK, async ($, on) => {
    const calls = repository(on, `feature/${TICKET}`, files(YOUTRACK_SETTINGS), youtrackAnswer())

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'plan', subtasks: [{ module: 'back-end', estimate: 60 }] }))

    expect(ran).toContain("demande d'abord : take")
    expect(calls.filter(one => one.method !== 'GET')).toEqual([])
  })

  test('plan creates one linked sub-task per module with its estimate, work and finish log the measured time on it', YOUTRACK, async ($, on) => {
    const repo = files(YOUTRACK_SETTINGS)
    const now = { at: 1_000_000 }
    const calls = repository(on, `feature/${TICKET}`, repo, youtrackAnswer(), now)
    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'take' })
    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'plan', subtasks: [{ module: 'back-end', title: 'API calendrier', estimate: 90 }] })
    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'work', subtask: 'back-end' })
    now.at += 40 * 60000

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'finish', subtask: 'back-end' }))

    expect(calls.some(one => one.url === 'https://acme.youtrack.cloud/api/commands' && JSON.stringify(one.body) === JSON.stringify({ query: `subtask of ${TICKET}`, issues: [{ idReadable: 'CORE-5' }] }))).toBe(true)
    expect(calls.some(one => one.url.startsWith('https://acme.youtrack.cloud/api/issues/CORE-5?') && JSON.stringify(one.body).includes('"minutes":90'))).toBe(true)
    const workItem = calls.find(one => one.url.includes('/api/issues/CORE-5/timeTracking/workItems'))
    expect((workItem?.body as { duration: { minutes: number } }).duration.minutes).toBe(45)
    expect(calls.some(one => one.url.startsWith('https://acme.youtrack.cloud/api/issues/CORE-5?') && JSON.stringify(one.body).includes('"name":"Done"'))).toBe(true)
    expect(ran).toContain('pull-request')
  })

  test('the pull request description comes from the team template', YOUTRACK, async ($, on) => {
    const repo = files(YOUTRACK_SETTINGS)
    repo.set('/repo/.claude/acceptance/feature_CORE-4.workflow.json', JSON.stringify({ ticket: TICKET, done: ['take', 'plan', 'work@CORE-5', 'finish@CORE-5'], subtasks: [{ ...BACK, spent: 45, closed: true }] }))
    repository(on, `feature/${TICKET}`, repo, youtrackAnswer())

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'pull-request', notes: 'Rien de spécial' }))

    expect(ran).toContain('## CORE-4 — Calendrier')
    expect(ran).toContain('- [x] **back-end** — API (CORE-5) · estimé 1 h · passé 45 min')
    expect(ran).toContain('Rien de spécial')
  })
})

describe('workflow gates', () => {
  test('without a ticket, editing code is refused with a proposal to create or resume one', YOUTRACK, async ($, on) => {
    repository(on, 'main', files(YOUTRACK_SETTINGS), youtrackAnswer())

    const ran = JSON.stringify(await $.tool.call({ tool: 'Edit', file_path: '/repo/apps/sophia-api/src/main.ts', old_string: 'a', new_string: 'b' } as never))

    expect(ran).toContain('create_ticket')
    expect(ran).toContain('use_ticket')
  })

  test('editing a module without its active sub-task is refused, the workflow files themselves are not', YOUTRACK, async ($, on) => {
    repository(on, `feature/${TICKET}`, files(YOUTRACK_SETTINGS), youtrackAnswer())
    on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'update', filePath: '/repo/.claude/acceptance-workflow.json' } }))

    const code = JSON.stringify(await $.tool.call({ tool: 'Edit', file_path: '/repo/apps/sophia-api/src/main.ts', old_string: 'a', new_string: 'b' } as never))
    const config = JSON.stringify(await $.tool.call({ tool: 'Write', file_path: '/repo/.claude/acceptance-workflow.json', content: '{}' } as never))

    expect(code).toContain('aucune sous-tâche ouverte pour le module « back-end »')
    expect(config).not.toContain('deny')
  })

  test('opening a pull request before every sub-task is finished is refused', YOUTRACK, async ($, on) => {
    const repo = files(YOUTRACK_SETTINGS)
    repo.set('/repo/.claude/acceptance/feature_CORE-4.workflow.json', JSON.stringify({ ticket: TICKET, done: ['take', 'plan', 'work@CORE-5'], subtasks: [BACK] }))
    repository(on, `feature/${TICKET}`, repo, youtrackAnswer())

    const ran = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' }))

    expect(ran).toContain('finish:all')
  })
})

const AZURE = { options: { token: 'https://dev.azure.com/acme pat' } }
const AZURE_SETTINGS = JSON.stringify({ tracker: 'azure-devops', trackerUrl: 'https://dev.azure.com/acme', azureProject: 'Shop', azureWorkItemType: 'User Story' })

describe('workflow_step on Azure DevOps', () => {
  test('plan creates a child Task with its original and remaining estimate, finish adds the time to Completed Work', AZURE, async ($, on) => {
    const repo = files(AZURE_SETTINGS, { ...WORKFLOW, tracker: { ...WORKFLOW.tracker, states: { active: 'Active', closed: 'Closed', done: { Bug: 'Resolved', 'User Story': 'Resolved' } }, fields: {} } })
    repo.set('/repo/.claude/acceptance/feature_42.workflow.json', JSON.stringify({ ticket: '42', done: ['take'], subtasks: [] }))
    const now = { at: 1_000_000 }
    const calls = repository(on, 'feature/42', repo, call => {
      if (call.url.endsWith('/_apis/connectionData')) return { authenticatedUser: { providerDisplayName: 'Alice', properties: { Account: { $value: 'alice@acme.com' } } } }
      if (call.method === 'PATCH' && call.url.includes('/workitems/$Task')) return { id: 43 }
      if (call.method === 'GET' && call.url.includes('/workitems/43')) return { id: 43, fields: { 'Microsoft.VSTS.Scheduling.CompletedWork': 0.5, 'Microsoft.VSTS.Scheduling.RemainingWork': 1.5 } }
      if (call.method === 'GET' && call.url.includes('/workitems/42')) return { id: 42, fields: { 'System.Title': 'Panier', 'System.WorkItemType': 'User Story' } }
      return {}
    }, now)

    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'plan', subtasks: [{ module: 'back-end', title: 'API panier', estimate: 120 }] })
    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'work', subtask: 'back-end' })
    now.at += 30 * 60000
    await $.tool.call({ tool: 'mcp__acceptance__workflow_step', step: 'finish', subtask: 'back-end' })

    const created = calls.find(one => one.url.includes('/workitems/$Task'))
    expect(created?.url.startsWith('https://dev.azure.com/acme/Shop/_apis/wit/workitems/$Task')).toBe(true)
    expect(JSON.stringify(created?.body)).toContain('"rel":"System.LinkTypes.Hierarchy-Reverse","url":"https://dev.azure.com/acme/_apis/wit/workItems/42"')
    expect(calls.some(one => one.method === 'PATCH' && one.url.includes('/workitems/43?') && JSON.stringify(one.body) === JSON.stringify([{ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate', value: 2 }, { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 2 }]))).toBe(true)
    expect(calls.some(one => JSON.stringify(one.body) === JSON.stringify([{ op: 'add', path: '/fields/System.AssignedTo', value: 'alice@acme.com' }]))).toBe(true)
    expect(calls.some(one => JSON.stringify(one.body) === JSON.stringify([{ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: 1 }, { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 1 }]))).toBe(true)
  })
})

describe('check_workflow', () => {
  test('flags a state, a type or a field the tracker does not have', YOUTRACK, async ($, on) => {
    repository(on, `feature/${TICKET}`, files(YOUTRACK_SETTINGS), call => {
      if (call.url.includes('/api/admin/projects?')) return [{ id: '0-1', shortName: 'CORE' }]
      if (call.url.includes('/customFields?')) return [{ field: { name: 'State' }, bundle: { values: [{ name: 'Open' }, { name: 'In Progress' }, { name: 'Done' }, { name: 'Fixed' }] } }, { field: { name: 'Type' }, bundle: { values: [{ name: 'Bug' }, { name: 'Task' }] } }, { field: { name: 'Assignee' } }]
      if (call.url.includes('/api/issueLinkTypes')) return [{ name: 'Subtask', sourceToTarget: 'parent for', targetToSource: 'subtask of' }]
      return {}
    })

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__check_workflow' }))

    expect(ran).toContain('état inconnu du tracker : « Testable »')
    expect(ran).toContain('type inconnu du tracker : « User Story »')
    expect(ran).toContain('champ inconnu du tracker : « Estimation »')
    expect(ran).not.toContain('lien inconnu')
  })
})

describe('journal', () => {
  test('lists what a person did on a day in YouTrack, with the time logged', YOUTRACK, async ($, on) => {
    const calls = repository(on, 'main', files(YOUTRACK_SETTINGS), call => {
      if (call.url.includes('/api/workItems?')) return [{ date: Date.parse('2026-10-20T09:00:00Z'), duration: { minutes: 45 }, text: 'CORE-4 — back-end', issue: { idReadable: 'CORE-5', summary: 'API' } }]
      if (call.url.includes('/api/activities?')) return [{ timestamp: Date.parse('2026-10-20T08:30:00Z'), target: { idReadable: 'CORE-4', summary: 'Calendrier' }, field: { name: 'State' }, added: [{ name: 'In Progress' }] }]
      return {}
    })

    const ran = JSON.stringify(await $.tool.call({ tool: 'mcp__acceptance__journal', person: 'alice', from: '2026-10-20' }))

    expect(calls[0]?.url).toContain('author=alice&startDate=2026-10-20&endDate=2026-10-20')
    expect(ran).toContain('Temps saisi : 45 min')
    expect(ran).toContain('CORE-4 Calendrier · State → In Progress')
    expect(ran.indexOf('State → In Progress')).toBeLessThan(ran.indexOf('temps saisi :'))
  })
})
