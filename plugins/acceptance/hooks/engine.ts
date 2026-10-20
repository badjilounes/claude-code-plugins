import {
  assigneeOf,
  commentRequest,
  createdIdOf,
  issueRequest,
  linkRequest,
  meOf,
  meRequest,
  numberField,
  projectIdOfIssue,
  projectOfRequest,
  subtaskRequest,
  titleOfIssue,
  typeOfIssue,
  updateRequest,
  workItemRequest,
} from './tracker'
import type { FieldChange, HttpRequest, Me, TrackerConfig } from './tracker'
import { actionOf, billableMinutes, doneKey, doneState, duration, missingFor, render, roundedMinutes, stepOf, subtaskOf } from './workflow'
import type { Action, Progress, Step, Subtask, Workflow } from './workflow'

export type StepInput = {
  subtask: string
  subtasks: { module: string; title: string; estimate: number }[]
  minutes: number | undefined
  notes: string
  prUrl: string
}

export type EngineDeps = {
  config: TrackerConfig
  workflow: Workflow
  ticket: { id: string; label: string; url: string }
  branch: string
  call: (request: HttpRequest) => Promise<unknown>
  now: () => Promise<number>
  template: (path: string) => Promise<string | undefined>
  scenarios: () => Promise<string>
  proofs: () => Promise<string>
}

export type StepResult = { progress: Progress; lines: string[]; output: string }

type Info = { projectId: string; type: string; title: string; assignee: string }

type Run = { deps: EngineDeps; progress: Progress; input: StepInput; step: Step; subtask: Subtask | undefined; lines: string[]; output: string; me?: Me; info?: Info; created: Subtask[] }

export function fieldsOf(config: TrackerConfig, workflow: Workflow): { state: string; assignee: string; estimate: string; spent: string; remaining: string } {
  const azure = config.kind === 'azure-devops'
  const fields = workflow.tracker.fields
  return {
    state: fields.state || (azure ? 'System.State' : 'State'),
    assignee: fields.assignee || (azure ? 'System.AssignedTo' : 'Assignee'),
    estimate: fields.estimate || (azure ? 'Microsoft.VSTS.Scheduling.OriginalEstimate' : 'Estimation'),
    spent: fields.spent || (azure ? 'Microsoft.VSTS.Scheduling.CompletedWork' : ''),
    remaining: azure ? 'Microsoft.VSTS.Scheduling.RemainingWork' : '',
  }
}

async function me(run: Run): Promise<Me> {
  run.me ??= meOf(run.deps.config, await run.deps.call(meRequest(run.deps.config)))
  if (run.me.login === '') throw new Error("impossible d'identifier l'utilisateur du jeton")
  return run.me
}

async function info(run: Run): Promise<Info> {
  if (run.info !== undefined) return run.info
  const { config, workflow, ticket } = run.deps
  const response = await run.deps.call(config.kind === 'azure-devops' ? issueRequest(config, ticket.id) : projectOfRequest(config, ticket.id))
  run.info = { projectId: projectIdOfIssue(response), type: typeOfIssue(config, response), title: titleOfIssue(config, response), assignee: assigneeOf(config, response, fieldsOf(config, workflow).assignee) }
  return run.info
}

function stateName(run: Run, key: Action & { kind: 'set-ticket-state' | 'set-subtask-state' }, type: string): string {
  const states = run.deps.workflow.tracker.states
  const name = key.state === 'done' ? doneState(run.deps.workflow, type) : states[key.state]
  if (name === '') throw new Error(`aucun état « ${key.state} » pour le type « ${type || '?'} » dans tracker.states`)
  return name
}

function change(field: string, kind: FieldChange['kind'], value: string | number): FieldChange {
  return { field, kind, value }
}

function current(run: Run): Subtask {
  if (run.subtask === undefined) throw new Error(`l'étape « ${run.step.id} » porte sur une sous-tâche : précise le module (subtask)`)
  return run.subtask
}

async function createSubtasks(run: Run): Promise<void> {
  const { config, workflow, ticket } = run.deps
  if (run.input.subtasks.length === 0) throw new Error('subtasks est vide : une sous-tâche par module touché, avec son titre et son estimation en minutes')
  const { projectId } = await info(run)
  for (const wanted of run.input.subtasks) {
    if (workflow.modules[wanted.module] === undefined) throw new Error(`module inconnu « ${wanted.module} » (${Object.keys(workflow.modules).join(', ')})`)
    if (subtaskOf(run.progress, wanted.module) !== undefined) throw new Error(`une sous-tâche est déjà ouverte pour « ${wanted.module} » : ferme-la avant d'en créer une autre`)
    const title = wanted.title.trim() || `${ticket.label} — ${wanted.module}`
    const id = createdIdOf(config, await run.deps.call(subtaskRequest(config, projectId, ticket.id, workflow.tracker.subtask.type, title, `Sous-tâche « ${wanted.module} » de ${ticket.label}.`)))
    if (id === '') throw new Error(`sous-tâche « ${wanted.module} » non créée : aucun identifiant rendu`)
    const link = linkRequest(config, id, workflow.tracker.subtask.link, ticket.id)
    if (link !== undefined) await run.deps.call(link)
    const subtask: Subtask = { module: wanted.module, id, title, estimate: Math.max(0, Math.round(wanted.estimate)), startedAt: 0, spent: 0, closed: false }
    run.progress = { ...run.progress, subtasks: [...run.progress.subtasks, subtask] }
    run.created.push(subtask)
    run.lines.push(`Sous-tâche ${id} créée : ${title}`)
  }
}

async function estimateSubtasks(run: Run): Promise<void> {
  const { config, workflow } = run.deps
  const fields = fieldsOf(config, workflow)
  for (const subtask of run.created.length > 0 ? run.created : run.progress.subtasks.filter(one => !one.closed)) {
    if (subtask.estimate <= 0) throw new Error(`estimation manquante pour « ${subtask.module} » (minutes)`)
    const changes = [change(fields.estimate, 'period', subtask.estimate), ...(fields.remaining !== '' ? [change(fields.remaining, 'period', subtask.estimate)] : [])]
    await run.deps.call(updateRequest(config, subtask.id, changes))
    run.lines.push(`${subtask.id} estimée à ${duration(subtask.estimate)}`)
  }
}

function updateSubtask(run: Run, subtask: Subtask, patch: Partial<Subtask>): Subtask {
  const next = { ...subtask, ...patch }
  run.progress = { ...run.progress, subtasks: run.progress.subtasks.map(one => (one.id === subtask.id ? next : one)) }
  run.subtask = next
  return next
}

async function logTime(run: Run): Promise<void> {
  const { config, workflow } = run.deps
  const subtask = current(run)
  const now = await run.deps.now()
  const measured = subtask.startedAt > 0 ? roundedMinutes(now - subtask.startedAt, workflow.time.round) : 0
  const minutes = run.input.minutes ?? measured
  if (minutes <= 0) throw new Error('aucun temps mesuré pour cette sous-tâche : indique minutes')
  const fields = fieldsOf(config, workflow)
  const workItem = workItemRequest(config, subtask.id, minutes, now, `${run.deps.ticket.label} — ${subtask.module}`)
  if (workItem !== undefined) await run.deps.call(workItem)
  else {
    const before = await run.deps.call(issueRequest(config, subtask.id))
    const spentBefore = numberField(before, fields.spent) * 60
    const remainingBefore = numberField(before, fields.remaining) * 60
    await run.deps.call(updateRequest(config, subtask.id, [change(fields.spent, 'period', spentBefore + minutes), change(fields.remaining, 'period', Math.max(0, remainingBefore - minutes))]))
  }
  const spent = subtask.spent + minutes
  updateSubtask(run, subtask, { spent })
  run.lines.push(`${duration(minutes)} saisies sur ${subtask.id}${run.input.minutes !== undefined && measured > 0 ? ` (mesuré : ${duration(measured)})` : ''}`)
  if (workflow.time.billable) {
    const billable = billableMinutes(spent, subtask.estimate)
    await run.deps.call(updateRequest(config, subtask.id, [change(workflow.tracker.fields.billable, 'period', billable)]))
    run.lines.push(`${workflow.tracker.fields.billable} : ${duration(billable)} (temps réel ${duration(spent)}, estimé ${duration(subtask.estimate)})`)
  }
}

function subtasksMarkdown(progress: Progress): string {
  if (progress.subtasks.length === 0) return '_Aucune sous-tâche._'
  return progress.subtasks.map(one => `- [${one.closed ? 'x' : ' '}] **${one.module}** — ${one.title} (${one.id}) · estimé ${duration(one.estimate)} · passé ${duration(one.spent)}`).join('\n')
}

async function rendered(run: Run, name: string): Promise<string> {
  const path = run.deps.workflow.templates[name] ?? ''
  const body = await run.deps.template(path)
  if (body === undefined) throw new Error(`template introuvable : ${path}`)
  const ticket = await info(run)
  const author = await me(run).then(one => one.name, () => '')
  return render(body, {
    'ticket.id': run.deps.ticket.label,
    'ticket.title': ticket.title,
    'ticket.url': run.deps.ticket.url,
    'ticket.type': ticket.type,
    branch: run.deps.branch,
    author,
    subtasks: subtasksMarkdown(run.progress),
    scenarios: await run.deps.scenarios(),
    proofs: await run.deps.proofs(),
    'pr.url': run.input.prUrl,
    notes: run.input.notes,
  }).trim()
}

async function perform(run: Run, action: Action): Promise<void> {
  const { config, workflow, ticket } = run.deps
  const fields = fieldsOf(config, workflow)
  if (action.kind === 'assign-ticket') {
    const user = await me(run)
    const { assignee } = await info(run)
    if (assignee !== '' && assignee.toLowerCase() !== user.login.toLowerCase()) return void run.lines.push(`${ticket.label} reste assigné à ${assignee} : tu travailles sur tes propres sous-tâches`)
    await run.deps.call(updateRequest(config, ticket.id, [change(fields.assignee, 'user', user.login)]))
    return void run.lines.push(`${ticket.label} assigné à ${user.name}`)
  }
  if (action.kind === 'set-ticket-state') {
    const name = stateName(run, action, (await info(run)).type)
    await run.deps.call(updateRequest(config, ticket.id, [change(fields.state, 'state', name)]))
    return void run.lines.push(`${ticket.label} → ${name}`)
  }
  if (action.kind === 'create-subtasks') return createSubtasks(run)
  if (action.kind === 'estimate-subtasks') return estimateSubtasks(run)
  if (action.kind === 'assign-subtask') {
    const subtask = current(run)
    const user = await me(run)
    await run.deps.call(updateRequest(config, subtask.id, [change(fields.assignee, 'user', user.login)]))
    return void run.lines.push(`${subtask.id} assignée à ${user.name}`)
  }
  if (action.kind === 'set-subtask-state') {
    const subtask = current(run)
    const name = stateName(run, action, workflow.tracker.subtask.type)
    await run.deps.call(updateRequest(config, subtask.id, [change(fields.state, 'state', name)]))
    if (action.state === 'active' && subtask.startedAt === 0) updateSubtask(run, subtask, { startedAt: await run.deps.now() })
    if (action.state !== 'active') updateSubtask(run, run.subtask ?? subtask, { closed: true })
    return void run.lines.push(`${subtask.id} → ${name}`)
  }
  if (action.kind === 'log-time') return logTime(run)
  if (action.kind === 'open-pr') {
    run.output = await rendered(run, action.template)
    return void run.lines.push(`Description de PR générée depuis le template « ${action.template} » : utilise-la telle quelle pour ouvrir la PR`)
  }
  const body = await rendered(run, action.template)
  await run.deps.call(commentRequest(config, ticket.id, body))
  run.lines.push(`Commentaire « ${action.template} » ajouté à ${ticket.label}`)
}

export async function runStep(deps: EngineDeps, progress: Progress, stepId: string, input: StepInput): Promise<StepResult> {
  const step = stepOf(deps.workflow, stepId)
  if (step === undefined) throw new Error(`étape inconnue « ${stepId} » (${deps.workflow.steps.map(one => one.id).join(', ')})`)
  const subtask = step.repeat ? subtaskOf(progress, input.subtask) : undefined
  if (step.repeat && subtask === undefined) throw new Error(`aucune sous-tâche ouverte pour le module « ${input.subtask || '?'} »`)
  const missing = missingFor(deps.workflow, progress, step, subtask)
  if (missing.length > 0) throw new Error(`l'étape « ${step.id} » demande d'abord : ${missing.join(', ')}`)
  const run: Run = { deps, progress, input, step, subtask, lines: [], output: '', created: [] }
  for (const raw of step.do) {
    const action = actionOf(raw)
    if (action === undefined) throw new Error(`action inconnue « ${raw} »`)
    try {
      await perform(run, action)
    } catch (error) {
      const done = run.lines.length > 0 ? `\nDéjà fait : ${run.lines.join(' ; ')}` : ''
      throw Object.assign(new Error(`${raw} : ${error instanceof Error ? error.message : String(error)}${done}`), { progress: run.progress })
    }
  }
  const key = doneKey(step, subtask)
  const progressed = { ...run.progress, done: run.progress.done.includes(key) ? run.progress.done : [...run.progress.done, key] }

  return { progress: progressed, lines: run.lines, output: run.output }
}
