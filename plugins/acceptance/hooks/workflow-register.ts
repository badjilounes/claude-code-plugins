import type { EngineInterface, On } from 'claude-code'

import { runStep } from './engine'
import type { EngineDeps, StepInput } from './engine'
import { currentName, projectIdOf, proofsMarkdown, repositoryRoot, required, scenariosMarkdown, trackerConfig } from './register'
import { azureJournalOf, displayId, isReady, issueUrl, journalIdsOf, journalRequests, meOf, meRequest, ticketOf, trackerName, updatesRequest, vocabularyOf, vocabularyRequests, youtrackJournalOf } from './tracker'
import type { HttpRequest, JournalEntry, TrackerConfig, Vocabulary } from './tracker'
import { PRESETS, TEMPLATE_PRESETS, TEMPLATES_DIR, WORKFLOW_FILE, duration, emptyProgress, gateProblem, moduleOf, nextSteps, parseWorkflow, progressOf, templateErrors } from './workflow'
import type { Progress, Workflow } from './workflow'

export const STEP_TOOL = 'workflow_step'
export const CHECK_TOOL = 'check_workflow'
export const VOCABULARY_TOOL = 'tracker_vocabulary'
export const JOURNAL_TOOL = 'journal'
export const WORKFLOW_COMMAND = 'acceptance-workflow'
export const JOURNAL_COMMAND = 'acceptance-journal'

const EDIT_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit)$/
const COMMIT = /(?:^|[;&|(]\s*|&&\s*)git\s+(?:-\S+\s+)*commit\b/m
const PR_CREATE = /(?:^|[;&|(]\s*|&&\s*)gh\s+pr\s+create\b/m
const PR_TOOLS = /^mcp__github__create_pull_request$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Loaded = { workflow: Workflow; errors: string[] } | undefined

function slug(name: string): string {
  return (name || 'detached').replace(/[^A-Za-z0-9._-]/g, '_')
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  return $.fs.read(path).catch(() => undefined)
}

async function loadWorkflow($: EngineInterface): Promise<Loaded> {
  const raw = await readText($, `${await repositoryRoot($)}/${WORKFLOW_FILE}`)
  if (raw === undefined) return undefined
  try {
    return parseWorkflow(JSON.parse(raw))
  } catch (error) {
    return { ...parseWorkflow({}), errors: [`${WORKFLOW_FILE} n'est pas du JSON valide : ${String(error)}`] }
  }
}

async function progressPath($: EngineInterface, branch: string): Promise<string> {
  return `${await repositoryRoot($)}/.claude/acceptance/${slug(branch)}.workflow.json`
}

async function loadProgress($: EngineInterface, branch: string, ticket: string): Promise<Progress> {
  const raw = await readText($, await progressPath($, branch))
  if (raw === undefined) return emptyProgress(ticket)
  try {
    return progressOf(JSON.parse(raw), ticket)
  } catch {
    return emptyProgress(ticket)
  }
}

async function saveProgress($: EngineInterface, branch: string, progress: Progress): Promise<void> {
  await $.fs.write(await progressPath($, branch), `${JSON.stringify(progress, undefined, 2)}\n`)
}

function relative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.replace(/^\.\//, '')
}

async function gate($: EngineInterface, kind: 'edit' | 'commit' | 'pullRequest', path: string): Promise<string> {
  const loaded = await loadWorkflow($)
  if (loaded === undefined || loaded.workflow.gates[kind] === '') return ''
  const root = await repositoryRoot($)
  const file = relative(root, path)
  if (kind === 'edit' && (file.startsWith('.claude/') || file.startsWith('/'))) return ''
  if (loaded.errors.length > 0) return `${WORKFLOW_FILE} est invalide (${loaded.errors[0]}) : corrige-le, /${WORKFLOW_COMMAND} check liste les erreurs.`
  const config = await trackerConfig($)
  const branch = await currentName($)
  const ticket = ticketOf(config, branch)
  if (ticket === '') return 'Le workflow de l\'équipe demande un ticket : propose à l\'utilisateur de le créer (mcp__acceptance__create_ticket) ou d\'en reprendre un (mcp__acceptance__use_ticket) avant de modifier le code.'
  const progress = await loadProgress($, branch, ticket)
  const module = kind === 'edit' ? moduleOf(loaded.workflow, file) : ''
  const problem = gateProblem(loaded.workflow, progress, kind, module)
  if (problem === '') return ''
  const next = nextSteps(loaded.workflow, progress)
  return `Workflow de l'équipe (${WORKFLOW_FILE}) : ${problem}.${next.length > 0 ? ` Prochaine étape : ${next.join(', ')} via mcp__acceptance__${STEP_TOOL}.` : ''}`
}

export async function bashGate($: EngineInterface, command: string): Promise<string> {
  if (PR_CREATE.test(command)) return gate($, 'pullRequest', '')
  if (COMMIT.test(command)) return gate($, 'commit', '')
  return ''
}

function statusText(workflow: Workflow, progress: Progress, label: string): string {
  const steps = workflow.steps.map(step => {
    if (!step.repeat) return `- [${progress.done.includes(step.id) ? 'x' : ' '}] ${step.id} : ${step.do.join(', ')}`
    const per = progress.subtasks.map(one => `${progress.done.includes(`${step.id}@${one.id}`) ? '✓' : '·'} ${one.module}`).join('  ')
    return `- ${step.id} (par sous-tâche) : ${step.do.join(', ')}${per !== '' ? ` — ${per}` : ''}`
  })
  const subtasks = progress.subtasks.map(one => `- ${one.id} ${one.module} — ${one.title} · estimé ${duration(one.estimate)} · passé ${duration(one.spent)}${one.closed ? ' · fermée' : ''}`)
  const next = nextSteps(workflow, progress)
  return [`Workflow de ${label}`, ...steps, '', subtasks.length > 0 ? 'Sous-tâches :' : 'Aucune sous-tâche.', ...subtasks, '', `Prochaine étape : ${next.join(', ') || 'aucune'}`].join('\n')
}

export async function workflowContext($: EngineInterface): Promise<string> {
  const loaded = await loadWorkflow($)
  if (loaded === undefined) return ''
  if (loaded.errors.length > 0) return `\n\nLe workflow de l'équipe (${WORKFLOW_FILE}) est invalide : ${loaded.errors.slice(0, 3).join(' ; ')}. Propose de le corriger (/${WORKFLOW_COMMAND} check).`
  const config = await trackerConfig($)
  const branch = await currentName($)
  const ticket = ticketOf(config, branch)
  const rule = `\n\n# Workflow de l'équipe (${WORKFLOW_FILE})\n\nChaque étape passe par mcp__acceptance__${STEP_TOOL} ; l'unité de travail est la sous-tâche : une par module touché, assignée à la personne qui la traite, et une nouvelle pour un ticket rouvert. Les portes refusent ${gated(loaded.workflow)} tant que l'étape requise n'est pas faite.`
  if (ticket === '') return `${rule}\nAucun ticket sur la branche : avant de modifier du code, propose de créer le ticket ou d'en reprendre un.`
  const progress = await loadProgress($, branch, ticket)
  return `${rule}\n\n${statusText(loaded.workflow, progress, displayId(config, ticket))}`
}

function gated(value: Workflow): string {
  const parts = [value.gates.edit !== '' ? 'la modification de code' : '', value.gates.commit !== '' ? 'le commit' : '', value.gates.pullRequest !== '' ? 'la PR' : ''].filter(Boolean)
  return parts.join(', ') || 'rien'
}

function inputOf(raw: Record<string, unknown>): StepInput {
  const subtasks = Array.isArray(raw.subtasks) ? raw.subtasks : []
  return {
    subtask: typeof raw.subtask === 'string' ? raw.subtask.trim() : '',
    subtasks: subtasks.map(one => {
      const value = typeof one === 'object' && one !== null ? (one as Record<string, unknown>) : {}
      return { module: String(value.module ?? '').trim(), title: String(value.title ?? ''), estimate: Number(value.estimate) || 0 }
    }),
    minutes: typeof raw.minutes === 'number' && raw.minutes > 0 ? Math.round(raw.minutes) : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    prUrl: typeof raw.prUrl === 'string' ? raw.prUrl : '',
  }
}

async function depsFor($: EngineInterface, workflow: Workflow, config: TrackerConfig, ticket: string, branch: string, call: (request: HttpRequest) => Promise<unknown>): Promise<EngineDeps> {
  const root = await repositoryRoot($)
  return {
    config,
    workflow,
    ticket: { id: ticket, label: displayId(config, ticket), url: issueUrl(config, ticket) },
    branch,
    call,
    now: () => $.clock.now(),
    template: path => readText($, `${root}/${path}`),
    scenarios: () => scenariosMarkdown($, branch),
    proofs: () => proofsMarkdown($, branch),
  }
}

async function stepTool($: EngineInterface, raw: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const loaded = await loadWorkflow($)
  if (loaded === undefined) return { deny: `Aucun workflow d'équipe : ${WORKFLOW_FILE} n'existe pas. /${WORKFLOW_COMMAND} aide à le créer.` }
  if (loaded.errors.length > 0) return { deny: `${WORKFLOW_FILE} est invalide :\n- ${loaded.errors.join('\n- ')}` }
  const config = await trackerConfig($)
  const branch = await currentName($)
  const ticket = ticketOf(config, branch)
  if (ticket === '') return { deny: "Aucun ticket sur la branche : crée-le (mcp__acceptance__create_ticket) ou reprends-en un (mcp__acceptance__use_ticket)." }
  const progress = await loadProgress($, branch, ticket)
  const step = typeof raw.step === 'string' ? raw.step.trim() : ''
  if (step === '') return { result: statusText(loaded.workflow, progress, displayId(config, ticket)) }
  if (!isReady(config)) return { deny: `${trackerName(config)} n'est pas configuré : le workflow écrit dans le tracker.` }
  const deps = await depsFor($, loaded.workflow, config, ticket, branch, request => required($, config, request))
  try {
    const done = await runStep(deps, progress, step, inputOf(raw))
    await saveProgress($, branch, done.progress)
    const next = nextSteps(loaded.workflow, done.progress)
    const output = done.output !== '' ? `\n\n--- Description de la PR ---\n${done.output}` : ''
    return { result: `Étape « ${step} » faite :\n- ${done.lines.join('\n- ') || '(rien à faire)'}\n\nProchaine étape : ${next.join(', ') || 'aucune'}${output}` }
  } catch (error) {
    const partial = (error as { progress?: Progress }).progress
    if (partial !== undefined) await saveProgress($, branch, partial)
    return { deny: `Étape « ${step} » non faite : ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function vocabulary($: EngineInterface, config: TrackerConfig): Promise<Vocabulary> {
  const projectId = config.kind === 'azure-devops' ? config.project : await projectIdOf($, config, config.projects[0] ?? '')
  if (config.kind === 'youtrack' && projectId === '') throw new Error(`projet YouTrack introuvable : ${config.projects[0] ?? '(aucun)'}`)
  const responses = []
  for (const request of vocabularyRequests(config, projectId)) responses.push(await required($, config, request))
  return vocabularyOf(config, responses)
}

async function moduleHints($: EngineInterface): Promise<string[]> {
  const ran = await $.process.run(['git', 'ls-files']).catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) return []
  const tops = ran.stdout.split('\n').filter(Boolean).map(path => path.split('/').slice(0, path.startsWith('libs/') ? 3 : 2).join('/'))
  return [...new Set(tops.filter(one => one.includes('/') && !one.startsWith('.')))].slice(0, 40)
}

async function vocabularyTool($: EngineInterface): Promise<{ result: string } | { deny: string }> {
  const config = await trackerConfig($)
  if (!isReady(config)) return { deny: `${trackerName(config)} n'est pas configuré : /acceptance-setup d'abord.` }
  try {
    const found = await vocabulary($, config)
    const hints = await moduleHints($)
    return {
      result: [
        `${trackerName(config)} — ${config.url} (${config.kind === 'azure-devops' ? config.project : config.projects.join(', ')})`,
        `Types : ${found.types.join(', ') || '?'}`,
        `États : ${found.states.join(', ') || '?'}`,
        `Champs : ${found.fields.join(', ') || '?'}`,
        config.kind === 'youtrack' ? `Liens : ${found.links.join(', ') || '?'}` : 'Sous-tâches : lien parent / enfant (System.LinkTypes.Hierarchy-Reverse)',
        `Dossiers du dépôt (pour les modules) : ${hints.join(', ') || '?'}`,
      ].join('\n'),
    }
  } catch (error) {
    return { deny: `Vocabulaire illisible : ${error instanceof Error ? error.message : String(error)}` }
  }
}

function trackerErrors(workflow: Workflow, config: TrackerConfig, found: Vocabulary): string[] {
  const errors: string[] = []
  const states = workflow.tracker.states
  const names = [states.active, states.closed, ...(typeof states.done === 'string' ? [states.done] : Object.values(states.done))]
  for (const name of names) if (found.states.length > 0 && !found.states.includes(name)) errors.push(`état inconnu du tracker : « ${name} » (${found.states.join(', ')})`)
  const types = [workflow.tracker.subtask.type, ...(typeof states.done === 'string' ? [] : Object.keys(states.done).filter(one => one !== '*'))]
  for (const type of types) if (found.types.length > 0 && !found.types.includes(type)) errors.push(`type inconnu du tracker : « ${type} » (${found.types.join(', ')})`)
  const fields = workflow.tracker.fields
  for (const field of [fields.state, fields.assignee, fields.estimate, fields.spent, fields.billable].filter(Boolean)) if (found.fields.length > 0 && !found.fields.includes(field)) errors.push(`champ inconnu du tracker : « ${field} »`)
  if (config.kind === 'youtrack' && found.links.length > 0 && !found.links.includes(workflow.tracker.subtask.link)) errors.push(`lien inconnu du tracker : « ${workflow.tracker.subtask.link} » (${found.links.join(', ')})`)
  return errors
}

async function check($: EngineInterface): Promise<string> {
  const loaded = await loadWorkflow($)
  if (loaded === undefined) return `${WORKFLOW_FILE} n'existe pas : /${WORKFLOW_COMMAND} init <minimal|per-module|full> en pose un.`
  const errors = [...loaded.errors]
  const root = await repositoryRoot($)
  for (const [name, path] of Object.entries(loaded.workflow.templates)) {
    const body = await readText($, `${root}/${path}`)
    if (body === undefined) errors.push(`template ${name} introuvable : ${path}`)
    else errors.push(...templateErrors(name, body))
  }
  const config = await trackerConfig($)
  let tracker = 'non vérifié contre le tracker (non configuré)'
  if (isReady(config) && loaded.errors.length === 0) {
    const found = await vocabulary($, config).catch((error: unknown) => String(error))
    if (typeof found === 'string') tracker = `non vérifié contre le tracker : ${found}`
    else {
      errors.push(...trackerErrors(loaded.workflow, config, found))
      tracker = `vérifié contre ${trackerName(config)}`
    }
  }
  return errors.length === 0 ? `${WORKFLOW_FILE} est valide (${tracker}).` : `${WORKFLOW_FILE} — ${errors.length} problème(s) (${tracker}) :\n- ${errors.join('\n- ')}`
}

async function dryRun($: EngineInterface, id: string): Promise<string> {
  const loaded = await loadWorkflow($)
  if (loaded === undefined || loaded.errors.length > 0) return check($)
  const config = await trackerConfig($)
  const ticket = id || ticketOf(config, await currentName($)) || 'TICKET-1'
  const requests: string[] = []
  let counter = 0
  const fake = (request: HttpRequest) => {
    requests.push(`${request.method} ${request.url}${request.body !== undefined ? `\n    ${request.body.slice(0, 300)}` : ''}`)
    counter += 1
    return Promise.resolve({ idReadable: `NEW-${counter}`, id: `${900000 + counter}`, login: 'moi', fullName: 'Moi', authenticatedUser: { providerDisplayName: 'Moi', properties: { Account: { $value: 'moi@example.com' } } } })
  }
  const deps = await depsFor($, loaded.workflow, config, ticket, await currentName($), fake)
  const modules = Object.keys(loaded.workflow.modules)
  let progress = emptyProgress(ticket)
  const lines: string[] = []
  for (const step of loaded.workflow.steps) {
    const targets = step.repeat ? progress.subtasks.filter(one => !one.closed).map(one => one.module) : ['']
    for (const module of targets.length > 0 ? targets : ['']) {
      requests.length = 0
      const input: StepInput = { subtask: module, subtasks: modules.slice(0, 2).map(name => ({ module: name, title: '', estimate: 60 })), minutes: 60, notes: '(notes)', prUrl: '(url de la PR)' }
      const ran = await runStep(deps, progress, step.id, input).catch((error: unknown) => String(error))
      if (typeof ran === 'string') lines.push(`■ ${step.id}${module !== '' ? ` (${module})` : ''} : ${ran}`)
      else {
        progress = ran.progress
        lines.push(`■ ${step.id}${module !== '' ? ` (${module})` : ''}`, ...requests.map(one => `  ${one}`))
      }
    }
  }
  return `Simulation sur ${displayId(config, ticket)} — rien n'est envoyé :\n${lines.join('\n')}`
}

async function init($: EngineInterface, preset: string): Promise<string> {
  const chosen = PRESETS[preset]
  if (chosen === undefined) return `Preset inconnu « ${preset} » : ${Object.keys(PRESETS).join(', ')}.`
  const root = await repositoryRoot($)
  if ((await readText($, `${root}/${WORKFLOW_FILE}`)) !== undefined) return `${WORKFLOW_FILE} existe déjà : modifie-le, puis /${WORKFLOW_COMMAND} check.`
  await $.fs.write(`${root}/${WORKFLOW_FILE}`, `${JSON.stringify(chosen, undefined, 2)}\n`)
  const written = [WORKFLOW_FILE]
  const templates = Object.values((chosen as { templates?: Record<string, string> }).templates ?? {})
  for (const path of templates) {
    const body = TEMPLATE_PRESETS[path.split('/').pop() ?? '']
    if (body !== undefined && (await readText($, `${root}/${path}`)) === undefined) {
      await $.fs.write(`${root}/${path}`, body)
      written.push(path)
    }
  }
  return `Preset « ${preset} » posé : ${written.join(', ')}. Remplace les <valeurs> par le vocabulaire de ton tracker (mcp__acceptance__${VOCABULARY_TOOL}), ajuste les modules, puis /${WORKFLOW_COMMAND} check.`
}

async function workflowCommand($: EngineInterface, args: string): Promise<{ text: string; context?: string[] }> {
  const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (verb === 'check') return { text: await check($) }
  if (verb === 'dry-run') return { text: await dryRun($, rest[0] ?? '') }
  if (verb === 'init') return { text: await init($, rest[0] ?? 'full') }
  const found = await vocabularyTool($)
  const known = 'result' in found ? found.result : found.deny
  return {
    text: `${known}\n\nCréer le workflow de l'équipe : /${WORKFLOW_COMMAND} init <minimal|per-module|full> pose un point de départ dans ${WORKFLOW_FILE} et ${TEMPLATES_DIR}/, check le valide contre le tracker, dry-run <ticket> montre les requêtes sans rien envoyer.`,
    context: [`L'utilisateur veut créer ou modifier le workflow d'équipe du plugin acceptance. Charge le skill acceptance-workflow-authoring, propose un ${WORKFLOW_FILE} à partir du vocabulaire ci-dessus et des dossiers du dépôt, ne demande que ce que tu ne peux pas déduire, écris les fichiers, puis valide avec mcp__acceptance__${CHECK_TOOL}.\n\n${known}`],
  }
}

function rangeOf(from: string, to: string): [string, string] | string {
  if (!DATE.test(from)) return 'from doit être une date AAAA-MM-JJ'
  if (to !== '' && !DATE.test(to)) return 'to doit être une date AAAA-MM-JJ'
  return [from, to || from]
}

async function gitLog($: EngineInterface, person: string, from: string, to: string): Promise<string[]> {
  const ran = await $.process.run(['git', 'log', '--all', `--author=${person}`, `--since=${from}T00:00:00`, `--until=${to}T23:59:59`, '--pretty=format:%ad %h %s', '--date=format:%Y-%m-%d %H:%M']).catch(() => undefined)
  return ran !== undefined && ran.exitCode === 0 ? ran.stdout.split('\n').filter(Boolean).slice(0, 200) : []
}

async function journal($: EngineInterface, person: string, from: string, to: string): Promise<string> {
  const config = await trackerConfig($)
  if (!isReady(config)) throw new Error(`${trackerName(config)} n'est pas configuré`)
  const login = person === '' || person === 'me' || person === 'moi' ? meOf(config, await required($, config, meRequest(config))).login : person
  const requests = journalRequests(config, login, from, to)
  let entries: JournalEntry[] = []
  if (config.kind === 'youtrack') entries = youtrackJournalOf(await Promise.all(requests.map(request => required($, config, request))))
  else {
    const loaded = await loadWorkflow($)
    const spent = loaded?.workflow.tracker.fields.spent || 'Microsoft.VSTS.Scheduling.CompletedWork'
    for (const id of journalIdsOf(await required($, config, requests[0] as HttpRequest))) entries.push(...azureJournalOf(id, await required($, config, updatesRequest(config, id)), login, from, to, spent))
    entries.sort((a, b) => a.at - b.at)
  }
  const total = entries.reduce((sum, one) => sum + one.minutes, 0)
  const lines = entries.map(one => `- ${new Date(one.at).toISOString().slice(0, 16).replace('T', ' ')} · ${displayId(config, one.ticket)} ${one.title} · ${one.what}${one.minutes > 0 ? ` (${duration(one.minutes)})` : ''}`)
  const commits = await gitLog($, login, from, to)
  return [
    `Journal de ${login} — ${from}${to !== from ? ` → ${to}` : ''} (${trackerName(config)})`,
    `Temps saisi : ${duration(total)}`,
    '',
    'Tracker :',
    ...(lines.length > 0 ? lines : ['- rien']),
    '',
    'Commits :',
    ...(commits.length > 0 ? commits.map(one => `- ${one}`) : ['- rien']),
  ].join('\n')
}

async function journalTool($: EngineInterface, raw: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const range = rangeOf(String(raw.from ?? ''), String(raw.to ?? ''))
  if (typeof range === 'string') return { deny: range }
  try {
    return { result: `${await journal($, String(raw.person ?? '').trim(), range[0], range[1])}\n\nRésume ce travail par ticket : ce qui a été fait et le temps passé, sans inventer ce qui n'est pas listé.` }
  } catch (error) {
    return { deny: `Journal illisible : ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function registerWorkflowTools($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: STEP_TOOL,
    description: `Fait une étape du workflow de l'équipe (${WORKFLOW_FILE}) sur le ticket de la branche : s'assigner, changer d'état, créer et estimer les sous-tâches, saisir le temps, générer la description de PR, poster les commentaires. Sans step : l'état du workflow et la prochaine étape.`,
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', description: "L'id de l'étape, tel que dans le fichier de workflow. Absent : affiche l'avancement." },
        subtask: { type: 'string', description: 'Pour une étape par sous-tâche : le module de la sous-tâche ouverte (ex. back-end).' },
        subtasks: {
          type: 'array',
          description: 'Pour create-subtasks : une sous-tâche par module touché, à faire valider par l’utilisateur avant.',
          items: { type: 'object', properties: { module: { type: 'string' }, title: { type: 'string' }, estimate: { type: 'number', description: 'Estimation en minutes.' } }, required: ['module', 'estimate'] },
        },
        minutes: { type: 'number', description: 'Pour log-time : le temps réellement passé, en minutes, si la mesure automatique est fausse (session interrompue).' },
        notes: { type: 'string', description: 'Texte libre pour les templates ({{notes}}) : comment tester, ce que montrent les preuves, ce qu’il faut savoir.' },
        prUrl: { type: 'string', description: 'L’URL de la PR, pour les templates ({{pr.url}}).' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({ name: CHECK_TOOL, description: `Valide ${WORKFLOW_FILE} et ses templates : structure, références, variables, et vocabulaire du tracker.`, inputSchema: { type: 'object', properties: {} }, isDeferred: false })
  await $.tool.register({ name: VOCABULARY_TOOL, description: "Lit le vocabulaire réel du tracker (types, états, champs, liens) et les dossiers du dépôt, pour écrire le workflow de l'équipe.", inputSchema: { type: 'object', properties: {} }, isDeferred: false })
  await $.tool.register({
    name: JOURNAL_TOOL,
    description: "Ce qu'une personne a fait sur une date ou une période : assignations, changements d'état et temps saisi dans le tracker, plus ses commits.",
    inputSchema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'Login YouTrack ou compte Azure DevOps (email) ; absent ou « me » : moi.' },
        from: { type: 'string', description: 'AAAA-MM-JJ' },
        to: { type: 'string', description: 'AAAA-MM-JJ, inclus ; absent : le même jour.' },
      },
      required: ['from'],
    },
    isDeferred: false,
  })
  await $.command.register({ name: WORKFLOW_COMMAND, description: "Crée, valide (check) ou simule (dry-run <ticket>) le workflow de l'équipe ; init <minimal|per-module|full> pose un point de départ" })
  await $.command.register({ name: JOURNAL_COMMAND, description: 'Journal de travail : /acceptance-journal <personne|me> <AAAA-MM-JJ> [AAAA-MM-JJ]' })
}

export function registerWorkflow(on: On): void {
  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const path = String(input.file_path ?? input.notebook_path ?? '')
    const problem = path === '' ? '' : await gate($, 'edit', path).catch(() => '')
    return problem === '' ? next(e) : { deny: problem }
  })
  on('tool.call', { tool: PR_TOOLS }, async ($, e, next) => {
    const problem = await gate($, 'pullRequest', '').catch(() => '')
    return problem === '' ? next(e) : { deny: problem }
  })
  on('tool.call', { tool: `mcp__acceptance__${STEP_TOOL}` }, async ($, e) => stepTool($, e as unknown as Record<string, unknown>))
  on('tool.call', { tool: `mcp__acceptance__${CHECK_TOOL}` }, async $ => ({ result: await check($) }))
  on('tool.call', { tool: `mcp__acceptance__${VOCABULARY_TOOL}` }, async $ => vocabularyTool($))
  on('tool.call', { tool: `mcp__acceptance__${JOURNAL_TOOL}` }, async ($, e) => journalTool($, e as unknown as Record<string, unknown>))
  on('command.run', { command: WORKFLOW_COMMAND }, async ($, e) => workflowCommand($, e.args))
  on('command.run', { command: JOURNAL_COMMAND }, async ($, e) => {
    const [person = 'me', from = '', to = ''] = e.args.trim().split(/\s+/).filter(Boolean)
    const range = rangeOf(from, to)
    if (typeof range === 'string') return { text: `${range}. Usage : /${JOURNAL_COMMAND} <personne|me> <AAAA-MM-JJ> [AAAA-MM-JJ]` }
    return { text: await journal($, person, range[0], range[1]).catch((error: unknown) => `Journal illisible : ${error instanceof Error ? error.message : String(error)}`) }
  })
}
