export const WORKFLOW_FILE = '.claude/acceptance-workflow.json'
export const TEMPLATES_DIR = '.claude/acceptance-templates'

export type StateKey = 'active' | 'closed' | 'done'

export type Workflow = {
  version: 1
  tracker: {
    states: { active: string; closed: string; done: string | Record<string, string> }
    subtask: { type: string; link: string }
    fields: { state: string; assignee: string; estimate: string; spent: string; billable: string }
  }
  modules: Record<string, string[]>
  steps: Step[]
  gates: { edit: string; commit: string; pullRequest: string }
  time: { round: number; billable: boolean }
  templates: Record<string, string>
}

export type Step = { id: string; do: string[]; requires: string[]; repeat: boolean }

export type Subtask = { module: string; id: string; title: string; estimate: number; startedAt: number; spent: number; closed: boolean }

export type Progress = { ticket: string; done: string[]; subtasks: Subtask[] }

export type Action =
  | { kind: 'assign-ticket' }
  | { kind: 'set-ticket-state'; state: StateKey }
  | { kind: 'create-subtasks' }
  | { kind: 'estimate-subtasks' }
  | { kind: 'assign-subtask' }
  | { kind: 'set-subtask-state'; state: StateKey }
  | { kind: 'log-time' }
  | { kind: 'open-pr'; template: string }
  | { kind: 'comment'; template: string }

export const PLACEHOLDERS = ['ticket.id', 'ticket.title', 'ticket.url', 'ticket.type', 'branch', 'author', 'subtasks', 'scenarios', 'proofs', 'pr.url', 'notes'] as const

const STATE_KEYS: readonly StateKey[] = ['active', 'closed', 'done']
const PLAIN_ACTIONS = ['assign-ticket', 'create-subtasks', 'estimate-subtasks', 'assign-subtask', 'log-time'] as const
const SUBTASK_ACTIONS = ['assign-subtask', 'set-subtask-state', 'log-time']
const PLACEHOLDER = /\{\{\s*([a-z.]+)\s*\}\}/g

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

export function actionOf(raw: string): Action | undefined {
  const [name = '', argument = ''] = raw.split(':')
  if ((PLAIN_ACTIONS as readonly string[]).includes(name) && argument === '') return { kind: name as (typeof PLAIN_ACTIONS)[number] }
  if ((name === 'set-ticket-state' || name === 'set-subtask-state') && (STATE_KEYS as readonly string[]).includes(argument)) return { kind: name, state: argument as StateKey }
  if ((name === 'open-pr' || name === 'comment') && argument !== '') return { kind: name, template: argument }
  return undefined
}

function stepsOf(value: unknown, errors: string[]): Step[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('steps : une liste d\'étapes est attendue')
    return []
  }
  return value.map((raw, at) => {
    const one = record(raw)
    const step: Step = { id: text(one.id), do: texts(one.do), requires: texts(one.requires), repeat: one.repeat === 'per-subtask' }
    if (step.id === '') errors.push(`steps[${at}] : id manquant`)
    if (step.do.length === 0) errors.push(`steps[${at}] (${step.id}) : do est vide`)
    for (const action of step.do) if (actionOf(action) === undefined) errors.push(`steps[${at}] (${step.id}) : action inconnue « ${action} »`)
    if (one.repeat !== undefined && one.repeat !== 'per-subtask') errors.push(`steps[${at}] (${step.id}) : repeat vaut « per-subtask » ou est absent`)
    return step
  })
}

function checkReferences(workflow: Workflow, errors: string[]): void {
  const ids = workflow.steps.map(step => step.id)
  ids.filter((id, at) => ids.indexOf(id) !== at).forEach(id => errors.push(`steps : id en double « ${id} »`))
  const known = (reference: string) => ids.includes(reference.replace(/:all$/, ''))
  for (const step of workflow.steps) {
    for (const reference of step.requires) if (!known(reference)) errors.push(`steps (${step.id}) : requires cite une étape inconnue « ${reference} »`)
    for (const raw of step.do) {
      const action = actionOf(raw)
      if (action !== undefined && SUBTASK_ACTIONS.includes(action.kind) && !step.repeat) errors.push(`steps (${step.id}) : ${raw} agit sur une sous-tâche, l'étape doit avoir repeat: "per-subtask"`)
      if (action !== undefined && 'template' in action && workflow.templates[action.template] === undefined) errors.push(`steps (${step.id}) : template inconnu « ${action.template} »`)
    }
  }
  for (const [gate, reference] of Object.entries(workflow.gates)) if (reference !== '' && !known(reference)) errors.push(`gates.${gate} cite une étape inconnue « ${reference} »`)
}

function trackerOf(value: unknown, errors: string[]): Workflow['tracker'] {
  const tracker = record(value)
  const states = record(tracker.states)
  const subtask = record(tracker.subtask)
  const fields = record(tracker.fields)
  const done = typeof states.done === 'object' ? Object.fromEntries(Object.entries(record(states.done)).map(([type, name]) => [type, text(name)])) : text(states.done)
  const result: Workflow['tracker'] = {
    states: { active: text(states.active), closed: text(states.closed), done },
    subtask: { type: text(subtask.type), link: text(subtask.link) || 'subtask of' },
    fields: { state: text(fields.state), assignee: text(fields.assignee), estimate: text(fields.estimate), spent: text(fields.spent), billable: text(fields.billable) },
  }
  if (result.states.active === '') errors.push('tracker.states.active manquant')
  if (result.states.closed === '') errors.push('tracker.states.closed manquant')
  if (typeof done === 'string' ? done === '' : Object.keys(done).length === 0) errors.push('tracker.states.done manquant')
  if (result.subtask.type === '') errors.push('tracker.subtask.type manquant')
  return result
}

export function parseWorkflow(raw: unknown): { workflow: Workflow; errors: string[] } {
  const errors: string[] = []
  const value = record(raw)
  if (value.version !== 1) errors.push('version : 1 attendu')
  const gates = record(value.gates)
  const time = record(value.time)
  const modules = Object.fromEntries(Object.entries(record(value.modules)).map(([name, globs]) => [name, texts(globs)]))
  const templates = Object.fromEntries(Object.entries(record(value.templates)).map(([name, path]) => [name, text(path)]))
  const workflow: Workflow = {
    version: 1,
    tracker: trackerOf(value.tracker, errors),
    modules,
    steps: stepsOf(value.steps, errors),
    gates: { edit: text(gates.edit), commit: text(gates.commit), pullRequest: text(gates.pullRequest) },
    time: { round: typeof time.round === 'number' && time.round > 0 ? time.round : 15, billable: time.billable === true },
    templates,
  }
  if (Object.keys(modules).length === 0) errors.push('modules : au moins un module est attendu')
  for (const [name, path] of Object.entries(templates)) if (!path.startsWith(`${TEMPLATES_DIR}/`) || path.includes('..')) errors.push(`templates.${name} doit être sous ${TEMPLATES_DIR}/`)
  if (workflow.time.billable && workflow.tracker.fields.billable === '') errors.push('time.billable demande tracker.fields.billable')
  checkReferences(workflow, errors)
  return { workflow, errors }
}

export function templateErrors(name: string, body: string): string[] {
  return [...body.matchAll(PLACEHOLDER)].map(match => match[1] ?? '').filter(key => !(PLACEHOLDERS as readonly string[]).includes(key)).map(key => `template ${name} : variable inconnue {{${key}}}`)
}

export function render(body: string, values: Partial<Record<(typeof PLACEHOLDERS)[number], string>>): string {
  return body.replace(PLACEHOLDER, (_all, key: string) => values[key as (typeof PLACEHOLDERS)[number]] ?? '')
}

function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at] ?? ''
    if (char === '*' && glob[at + 1] === '*') {
      pattern += glob[at + 2] === '/' ? '(?:.*/)?' : '.*'
      at += glob[at + 2] === '/' ? 2 : 1
    } else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${pattern}$`)
}

export function moduleOf(workflow: Workflow, path: string): string {
  const relative = path.replace(/^\.\//, '')
  return Object.entries(workflow.modules).find(([, globs]) => globs.some(glob => globToRegExp(glob).test(relative)))?.[0] ?? ''
}

export function stepOf(workflow: Workflow, id: string): Step | undefined {
  return workflow.steps.find(step => step.id === id)
}

export function subtaskOf(progress: Progress, module: string): Subtask | undefined {
  return progress.subtasks.find(one => one.module === module && !one.closed)
}

function doneFor(progress: Progress, step: string, subtask: Subtask): boolean {
  return progress.done.includes(`${step}@${subtask.id}`)
}

export function doneKey(step: Step, subtask: Subtask | undefined): string {
  return step.repeat && subtask !== undefined ? `${step.id}@${subtask.id}` : step.id
}

export function isDone(workflow: Workflow, progress: Progress, reference: string, subtask: Subtask | undefined): boolean {
  const all = reference.endsWith(':all')
  const step = stepOf(workflow, reference.replace(/:all$/, ''))
  if (step === undefined) return false
  if (!step.repeat) return progress.done.includes(step.id)
  if (all) return progress.subtasks.length > 0 && progress.subtasks.every(one => doneFor(progress, step.id, one))
  if (subtask !== undefined) return doneFor(progress, step.id, subtask)
  return progress.subtasks.some(one => !one.closed && doneFor(progress, step.id, one))
}

export function missingFor(workflow: Workflow, progress: Progress, step: Step, subtask: Subtask | undefined): string[] {
  return step.requires.filter(reference => !isDone(workflow, progress, reference, step.repeat ? subtask : undefined))
}

export function gateProblem(workflow: Workflow, progress: Progress, gate: keyof Workflow['gates'], module: string): string {
  const reference = workflow.gates[gate]
  if (reference === '') return ''
  const step = stepOf(workflow, reference.replace(/:all$/, ''))
  if (step === undefined) return ''
  if (!step.repeat || reference.endsWith(':all')) return isDone(workflow, progress, reference, undefined) ? '' : `l'étape « ${reference} » n'est pas faite`
  if (module === '') return isDone(workflow, progress, step.id, undefined) ? '' : `aucune sous-tâche en cours : lance l'étape « ${step.id} »`
  const subtask = subtaskOf(progress, module)
  if (subtask === undefined) return `aucune sous-tâche ouverte pour le module « ${module} » : crée-la avec l'étape de planification`
  return doneFor(progress, step.id, subtask) ? '' : `lance l'étape « ${step.id} » pour la sous-tâche « ${module} »`
}

export function nextSteps(workflow: Workflow, progress: Progress): string[] {
  const open = progress.subtasks.filter(one => !one.closed)
  return workflow.steps.flatMap(step => {
    if (!step.repeat) return progress.done.includes(step.id) || missingFor(workflow, progress, step, undefined).length > 0 ? [] : [step.id]
    return open.filter(one => !doneFor(progress, step.id, one) && missingFor(workflow, progress, step, one).length === 0).map(one => `${step.id} (${one.module})`)
  })
}

export function roundedMinutes(elapsedMs: number, round: number): number {
  const minutes = elapsedMs / 60000
  return Math.max(round, Math.ceil(minutes / round) * round)
}

export function billableMinutes(spent: number, estimate: number): number {
  return Math.max(spent, estimate)
}

export function doneState(workflow: Workflow, type: string): string {
  const done = workflow.tracker.states.done
  if (typeof done === 'string') return done
  return done[type] ?? done['*'] ?? ''
}

export function emptyProgress(ticket: string): Progress {
  return { ticket, done: [], subtasks: [] }
}

export function progressOf(raw: unknown, ticket: string): Progress {
  const value = record(raw)
  if (text(value.ticket) !== ticket) return emptyProgress(ticket)
  const subtasks = Array.isArray(value.subtasks) ? value.subtasks.map(record) : []
  return {
    ticket,
    done: texts(value.done),
    subtasks: subtasks.map(one => ({
      module: text(one.module),
      id: text(one.id),
      title: text(one.title),
      estimate: Number(one.estimate) || 0,
      startedAt: Number(one.startedAt) || 0,
      spent: Number(one.spent) || 0,
      closed: one.closed === true,
    })),
  }
}

export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest}`
}

export const PRESETS: Record<string, unknown> = {
  minimal: {
    version: 1,
    tracker: { states: { active: '<état en cours>', closed: '<état fermé>', done: '<état livré>' }, subtask: { type: '<type de sous-tâche>' }, fields: {} },
    modules: { code: ['**'] },
    steps: [
      { id: 'take', do: ['assign-ticket', 'set-ticket-state:active'] },
      { id: 'hand-over', do: ['set-ticket-state:done'], requires: ['take'] },
    ],
    gates: { edit: 'take' },
    templates: {},
  },
  'per-module': {
    version: 1,
    tracker: { states: { active: '<état en cours>', closed: '<état fermé>', done: '<état livré>' }, subtask: { type: '<type de sous-tâche>' }, fields: { estimate: '<champ estimation>', spent: '<champ temps passé>' } },
    modules: { 'back-end': ['apps/*-api/**'], 'front-end': ['apps/*-web/**'] },
    steps: [
      { id: 'take', do: ['assign-ticket', 'set-ticket-state:active'] },
      { id: 'plan', do: ['create-subtasks', 'estimate-subtasks'], requires: ['take'] },
      { id: 'work', repeat: 'per-subtask', do: ['assign-subtask', 'set-subtask-state:active'], requires: ['plan'] },
      { id: 'finish', repeat: 'per-subtask', do: ['log-time', 'set-subtask-state:closed'], requires: ['work'] },
      { id: 'hand-over', do: ['set-ticket-state:done'], requires: ['finish:all'] },
    ],
    gates: { edit: 'work', commit: 'work', pullRequest: 'finish:all' },
    time: { round: 15 },
    templates: {},
  },
  full: {
    version: 1,
    tracker: {
      states: { active: '<état en cours>', closed: '<état fermé>', done: { '<type bug>': '<état résolu>', '<type story>': '<état testable>', '*': '<état livré>' } },
      subtask: { type: '<type de sous-tâche>' },
      fields: { estimate: '<champ estimation>', spent: '<champ temps passé>' },
    },
    modules: { 'back-end': ['apps/*-api/**'], 'front-end': ['apps/*-web/**'], 'design-system': ['libs/**/ui/**'] },
    steps: [
      { id: 'take', do: ['assign-ticket', 'set-ticket-state:active'] },
      { id: 'plan', do: ['create-subtasks', 'estimate-subtasks'], requires: ['take'] },
      { id: 'work', repeat: 'per-subtask', do: ['assign-subtask', 'set-subtask-state:active'], requires: ['plan'] },
      { id: 'finish', repeat: 'per-subtask', do: ['log-time', 'set-subtask-state:closed'], requires: ['work'] },
      { id: 'pull-request', do: ['open-pr:pullRequest'], requires: ['finish:all'] },
      { id: 'how-to-test', do: ['comment:howToTest'], requires: ['pull-request'] },
      { id: 'proofs', do: ['comment:proofs'], requires: ['pull-request'] },
      { id: 'hand-over', do: ['set-ticket-state:done'], requires: ['how-to-test', 'proofs'] },
    ],
    gates: { edit: 'work', commit: 'work', pullRequest: 'finish:all' },
    time: { round: 15 },
    templates: {
      pullRequest: `${TEMPLATES_DIR}/pull-request.md`,
      howToTest: `${TEMPLATES_DIR}/how-to-test.md`,
      proofs: `${TEMPLATES_DIR}/proofs.md`,
    },
  },
}

export const TEMPLATE_PRESETS: Record<string, string> = {
  'pull-request.md': '## {{ticket.id}} — {{ticket.title}}\n\n{{ticket.url}}\n\n### Sous-tâches\n\n{{subtasks}}\n\n### Critères d\'acceptation\n\n{{scenarios}}\n\n### Notes\n\n{{notes}}\n',
  'how-to-test.md': '## Comment tester {{ticket.id}}\n\nBranche : `{{branch}}` — PR : {{pr.url}}\n\n{{notes}}\n\n### Critères à vérifier\n\n{{scenarios}}\n',
  'proofs.md': '## Preuves — {{ticket.id}}\n\n{{proofs}}\n\n{{notes}}\n',
}
