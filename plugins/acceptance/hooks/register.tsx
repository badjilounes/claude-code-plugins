import type { EngineInterface, Register } from 'claude-code'

import type { BranchInfo, BranchStatus, Evidence, EvidenceKind, EvidenceMedia, Pages, Ticket } from '../types'

import { proofsPage, rulesPage, ticketPage } from './pages'
import {
  authHeader,
  commentRequest,
  commentsRequest,
  configOf,
  createRequest,
  createdIdOf,
  descriptionFor,
  descriptionRequest,
  displayId,
  exampleId,
  isReady,
  isTicketId,
  curlLines,
  isProofId,
  isTrackerUrl,
  labelOf,
  safeFileName,
  trackerName,
  issueOf,
  issueRequest,
  issueUrl,
  linkAttachmentRequest,
  projectsRequest,
  proofMarker,
  proofOf,
  ticketOf,
  uploadLines,
  uploadedUrlOf,
  withRules,
} from './tracker'
import type { HttpRequest, Issue, TrackerConfig } from './tracker'
import type { PageLinks, PageProof, PageSubject, PageTicket } from './pages'

import { THEME, ring } from './look'

const RULES = 'acceptance-rules'
const PROOFS = 'acceptance-proofs'
const TOOL = 'add_evidence'
const KINDS: readonly EvidenceKind[] = ['capture', 'video', 'curl', 'test', 'artifact', 'file', 'other']
const IMAGE = /\.(png|jpe?g|gif|webp|heic)$/i
const VIDEO = /\.(mp4|mov|webm|m4v)$/i
const KEPT = /\.(png|jpe?g|gif|webp|heic|mp4|mov|webm|m4v|pdf|txt|log|json|har|md)$/i
const TEXT = /\.(txt|log|json|har|md)$/i
const TEST_RUN = /(?:^|[;&|(]\s*|&&\s*)(?:npx\s+)?(?:jest|vitest|playwright test|maestro test|nx (?:run-many\s+[^\n]*?)?test|npm (?:run )?(?:test|verify))\b/m

const EVIDENCE = { plugin: 'acceptance', key: 'evidence' } as const
const BRANCH = { plugin: 'acceptance', key: 'branch' } as const
const CRITERIA = { plugin: 'acceptance', key: 'criteria' } as const
const TICKET = { plugin: 'acceptance', key: 'ticket' } as const
const COLLAPSED = { plugin: 'acceptance', key: 'collapsed' } as const
const PAGES = { plugin: 'acceptance', key: 'pages' } as const

const NO_BRANCH: BranchInfo = { name: '', status: 'none', url: '', pr: 0 }
const NO_TICKET: Ticket = { id: '', url: '', summary: '', context: '' }
const NO_PAGES: Pages = { ticket: '', rules: '', proofs: '' }

const thumbnails = new Map<string, string>()

const GROUP_OF: Record<EvidenceKind, string> = {
  capture: 'Captures',
  video: 'Vidéos',
  curl: 'Requêtes cURL',
  test: 'Tests',
  artifact: 'Artefacts',
  file: 'Fichiers',
  other: 'Autres preuves',
}
const GLYPH: Record<EvidenceMedia, string> = { image: '▣', video: '▶', text: '≡', pdf: '⎙', '': '↗' }

function linkOf(item: Evidence): string {
  return item.detail.match(/https:\/\/\S+/)?.[0] ?? ''
}

type Scenario = { name: string; steps: string[] }
type Subject = { name: string; scenarios: Scenario[] }
type Rules = { feature: string; subjects: Subject[] }

function parseRules(text: string): Rules {
  const rules: Rules = { feature: '', subjects: [] }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const feature = line.match(/^(?:Feature|Fonctionnalité)\s*:\s*(.*)$/)?.[1]
    const rule = line.match(/^(?:Rule|Règle)\s*:\s*(.*)$/)?.[1]
    const scenario = line.match(/^(?:Scenario|Scénario)(?: Outline)?\s*:\s*(.*)$/)?.[1]
    if (feature !== undefined) rules.feature = feature
    else if (rule !== undefined) rules.subjects.push({ name: rule, scenarios: [] })
    else if (scenario !== undefined) {
      if (rules.subjects.length === 0) rules.subjects.push({ name: '', scenarios: [] })
      rules.subjects[rules.subjects.length - 1]?.scenarios.push({ name: scenario, steps: [] })
    } else if (/^(Given|When|Then|And|But|\*)\b/.test(line)) {
      const subject = rules.subjects[rules.subjects.length - 1]
      subject?.scenarios[subject.scenarios.length - 1]?.steps.push(line)
    }
  }

  return rules
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function grouped(list: Evidence[]): [string, Evidence[]][] {
  const groups = new Map<string, Evidence[]>()
  for (const item of list) {
    const heading = item.title || GROUP_OF[item.kind]
    groups.set(heading, [...(groups.get(heading) ?? []), item])
  }
  const visual = (items: Evidence[]) => (items.some(one => one.media !== '') ? 0 : 1)

  return [...groups.entries()].sort((a, b) => visual(a[1]) - visual(b[1]))
}

function slug(name: string): string {
  return (name || 'detached').replace(/[^A-Za-z0-9._-]/g, '_')
}

function cropped(item: Evidence, base64: string, width: number, height: number): string {
  const r = Math.min(10, Math.round(width / 12))
  const play =
    item.media === 'video'
      ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.max(10, Math.round(width / 9))}" fill="rgba(0,0,0,0.55)"/><path d="M${width / 2 - width / 30} ${height / 2 - width / 20} L${width / 2 + width / 18} ${height / 2} L${width / 2 - width / 30} ${height / 2 + width / 20} Z" fill="#fff"/>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath></defs><g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="#E8E5DC"/><image href="data:image/jpeg;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMin slice"/>${play}</g><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${r}" fill="none" stroke="rgba(138,137,132,0.35)"/></svg>`
}

function mediaOf(path: string): EvidenceMedia {
  if (IMAGE.test(path)) return 'image'
  if (VIDEO.test(path)) return 'video'
  if (TEXT.test(path)) return 'text'
  return /\.pdf$/i.test(path) ? 'pdf' : ''
}

function fileSlug(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'preuve'
}

function textProof(proof: { kind: EvidenceKind; title: string; subtitle: string; scenario: string; detail: string }): string {
  const heading = [proof.title || GROUP_OF[proof.kind], proof.subtitle].filter(Boolean).join(' — ')
  const scenario = proof.scenario !== '' ? `# Scénario : ${proof.scenario}\n` : ''

  return `# ${heading}\n${scenario}# Type : ${proof.kind}\n\n${proof.detail.trim()}\n`
}

function repoUrl(remote: string): string {
  const match = remote.trim().match(/github\.com[:/](.+?)(\.git)?$/)

  return match?.[1] !== undefined ? `https://github.com/${match[1]}` : ''
}

function prStatus(state: unknown, isDraft: unknown): BranchStatus {
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  return isDraft === true ? 'draft' : 'open'
}

function proofComment(item: Evidence, fileName: string, content: string): string {
  const marker = proofMarker({ id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, scenario: item.scenario, detail: item.detail, file: fileName, at: item.at })
  const body = content !== '' ? content : item.detail
  const detail = body !== '' ? `\n\n\`\`\`\n${body.replace(/```/g, "'''")}\n\`\`\`` : ''
  const media = fileName === '' ? '' : item.media === 'image' ? `\n\n![${item.title}](${fileName})` : `\n\n[${fileName}](${fileName})`

  const heading = [item.title || GROUP_OF[item.kind], item.subtitle].filter(Boolean).join(' — ')
  const proves = item.scenario !== '' ? `\n\nScénario prouvé : _${item.scenario}_` : ''

  return `**Preuve** · ${heading}${proves}${detail}${media}\n\n${marker}`
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  if (!(await $.fs.exists(path))) return undefined
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

let OPTIONS: Readonly<Record<string, unknown>> = {}

async function trackerConfig($: EngineInterface): Promise<TrackerConfig> {
  return configOf(OPTIONS, (await $.env.get('ACCEPTANCE_TRACKER_TOKEN').catch(() => undefined)) ?? '')
}

async function send($: EngineInterface, config: TrackerConfig, request: HttpRequest): Promise<unknown> {
  if (!isReady(config)) return undefined
  const response = await $.http.fetch(request.url, { method: request.method, headers: request.headers, body: request.body }).catch(() => undefined)
  if (response === undefined || !response.ok) return undefined
  try {
    return JSON.parse(response.text || '{}')
  } catch {
    return {}
  }
}

async function curl($: EngineInterface, config: TrackerConfig, lines: string[]): Promise<string> {
  if (!isReady(config)) return ''
  if (lines.length === 0) return ''
  const script = [...curlLines([['header', `Authorization: ${authHeader(config)}`]]), 'silent', 'show-error', 'fail', 'proto = "=https"', ...lines].join('\n')
  const ran = await $.process.run(['curl', '--config', '-'], { stdin: `${script}\n`, timeoutMs: 120000 }).catch(() => undefined)

  return ran !== undefined && ran.exitCode === 0 ? ran.stdout : ''
}

async function fetchIssue($: EngineInterface, config: TrackerConfig, id: string): Promise<Issue | undefined> {
  const response = await send($, config, issueRequest(config, id))
  if (response === undefined) return undefined
  const extra = commentsRequest(config, id)
  const comments = extra === undefined ? undefined : await send($, config, extra)

  return issueOf(config, response, comments)
}

async function sized($: EngineInterface, path: string): Promise<[number, number]> {
  const { stdout } = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])

  return [Number(stdout.match(/pixelWidth: (\d+)/)?.[1] ?? 0), Number(stdout.match(/pixelHeight: (\d+)/)?.[1] ?? 0)]
}

async function withThumbnails($: EngineInterface, item: Evidence): Promise<Evidence> {
  if (item.media === '' || item.file === '') return item
  if (item.media !== 'image' && item.media !== 'video') return item
  const thumb = `${item.file}.thumb.jpg`
  const large = `${item.file}.large.jpg`
  const poster = `${item.file}.poster.png`
  if (item.media === 'image') {
    await $.process.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', '-Z', '240', item.file, '--out', thumb])
    await $.process.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '55', '-Z', '760', item.file, '--out', large])
    await $.process.run(['sips', '-s', 'format', 'png', '-Z', '640', item.file, '--out', poster])
  } else {
    const frame = (scale: string, out: string, quality: string[]) =>
      ['ffmpeg', '-y', '-loglevel', 'error', '-ss', '0.5', '-i', item.file, '-frames:v', '1', '-vf', `scale=${scale}:-2`, ...quality, out]
    await $.process.run(frame('240', thumb, ['-q:v', '6']), { timeoutMs: 60000 })
    await $.process.run(frame('760', large, ['-q:v', '8']), { timeoutMs: 60000 })
    await $.process.run(frame('640', poster, []), { timeoutMs: 60000 })
  }
  if (!(await $.fs.exists(thumb))) return item
  const [width, height] = await sized($, large)
  const has = async (path: string) => ((await $.fs.exists(path)) ? path : '')

  return { ...item, thumb, large: await has(large), poster: await has(poster), width, height }
}

async function pushProof($: EngineInterface, config: TrackerConfig, ticket: string, item: Evidence): Promise<Evidence> {
  const fileName = item.file !== '' ? (item.file.split('/').pop() ?? '') : ''
  const content = item.media === 'text' ? await $.fs.read(item.file).then(text => text.slice(0, 4000), () => '') : ''
  let remote = item.remote
  if (fileName !== '' && remote === '') {
    remote = uploadedUrlOf(config, await curl($, config, uploadLines(config, ticket, item.file, fileName)))
    if (remote === '') return item
    const link = linkAttachmentRequest(config, ticket, remote, fileName)
    if (link !== undefined) await send($, config, link)
  }
  const posted = await send($, config, commentRequest(config, ticket, proofComment(item, fileName, content)))

  return posted === undefined ? { ...item, remote } : { ...item, remote, isSynced: true }
}

async function evidenceFromComment($: EngineInterface, config: TrackerConfig, text: string, attachments: { name: string; url: string }[], dir: string): Promise<Evidence | undefined> {
  const parsed = proofOf(text)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const mark = parsed as { id?: unknown; kind?: EvidenceKind; title?: unknown; subtitle?: unknown; scenario?: unknown; detail?: unknown; file?: unknown; at?: unknown }
  if (!isProofId(mark.id)) return undefined
  const words = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')
  const fileName = safeFileName(words(mark.file, 128))
  const attachment = fileName === '' ? undefined : attachments.find(one => one.name === fileName)
  const remote = attachment !== undefined && isTrackerUrl(config, attachment.url) ? attachment.url : ''
  let file = ''
  if (remote !== '') {
    file = `${dir}/${fileName}`
    if (!(await $.fs.exists(file))) {
      await $.process.run(['mkdir', '-p', dir])
      await curl($, config, curlLines([['url', remote], ['output', file]]))
      if (!(await $.fs.exists(file))) file = ''
    }
  }
  const item: Evidence = {
    id: mark.id,
    kind: KINDS.find(one => one === mark.kind) ?? 'other',
    title: words(mark.title, 160),
    subtitle: words(mark.subtitle, 160),
    scenario: words(mark.scenario, 200),
    detail: words(mark.detail, 600),
    file,
    media: file !== '' ? mediaOf(file) : '',
    thumb: '',
    poster: '',
    large: '',
    width: 0,
    height: 0,
    remote,
    page: '',
    isSynced: true,
    at: typeof mark.at === 'number' && Number.isFinite(mark.at) ? mark.at : 0,
  }

  return withThumbnails($, item)
}

async function pullTicket($: EngineInterface, config: TrackerConfig, ticket: string, base: string, local: Evidence[]): Promise<[Ticket, string, Evidence[]] | undefined> {
  const issue = await fetchIssue($, config, ticket)
  if (issue === undefined) return undefined
  const known = new Set(local.map(one => one.id))
  const cwd = await $.session.cwd()
  const recovered: Evidence[] = []
  for (const comment of issue.comments) {
    const mark = proofOf(comment) as { id?: unknown } | undefined
    if (!isProofId(mark?.id) || known.has(mark.id)) continue
    const item = await evidenceFromComment($, config, comment, issue.attachments, `${cwd}/${base}/proofs`)
    if (item !== undefined) recovered.push(item)
  }
  const pushed: Evidence[] = []
  for (const item of local) pushed.push(item.isSynced ? item : await pushProof($, config, ticket, item))
  const list = [...pushed, ...recovered].sort((a, b) => a.at - b.at)

  return [{ id: ticket, url: issueUrl(config, ticket), summary: issue.summary, context: issue.context }, issue.rules, list]
}

async function currentName($: EngineInterface): Promise<string> {
  const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'])

  return exitCode === 0 ? stdout.trim() : ''
}

async function readLocal($: EngineInterface, name: string): Promise<[string, Evidence[]]> {
  const base = `.claude/acceptance/${slug(name)}`
  const text = (await $.fs.exists(`${base}.feature`)) ? await $.fs.read(`${base}.feature`) : ''
  const proofs = await readJson($, `${base}.evidence.json`)

  return [text, Array.isArray(proofs) ? (proofs as Evidence[]) : []]
}

async function publish($: EngineInterface, name: string, ticket: Ticket, text: string, list: Evidence[]): Promise<void> {
  const previous = (await $.state.get(BRANCH)).value ?? NO_BRANCH
  if (previous.name !== name) await $.state.set(BRANCH, { ...NO_BRANCH, name, status: name === '' ? 'none' : 'clean' })
  if (JSON.stringify((await $.state.get(TICKET)).value) !== JSON.stringify(ticket)) await $.state.set(TICKET, ticket)
  if ((await $.state.get(CRITERIA)).value !== text) await $.state.set(CRITERIA, text)
  if (JSON.stringify((await $.state.get(EVIDENCE)).value ?? []) !== JSON.stringify(list)) await $.state.set(EVIDENCE, list)
}

async function refreshLocal($: EngineInterface): Promise<string> {
  const name = await currentName($)
  const [text, list] = await readLocal($, name)
  const config = await trackerConfig($)
  const id = ticketOf(config, name) ?? ''
  const held = (await $.state.get(TICKET)).value ?? NO_TICKET
  const ticket: Ticket = id === '' ? NO_TICKET : held.id === id ? held : { id, url: issueUrl(config, id), summary: '', context: '' }
  await publish($, name, ticket, text, list)
  const pages = await readPages($, `.claude/acceptance/${slug(name)}`)
  const links: Pages = { ticket: pages.ticket, rules: pages.rules, proofs: pages.proofs }
  if (JSON.stringify((await $.state.get(PAGES)).value) !== JSON.stringify(links)) await $.state.set(PAGES, links)

  return name
}

async function syncTicket($: EngineInterface, name: string): Promise<void> {
  const config = await trackerConfig($)
  const id = ticketOf(config, name)
  if (id === '' || !isReady(config)) return
  const base = `.claude/acceptance/${slug(name)}`
  const [localText, local] = await readLocal($, name)
  const pulled = await pullTicket($, config, id, base, local)
  if (pulled === undefined) return
  const [ticket, rules, list] = pulled
  const text = rules !== '' ? `${rules}\n` : localText
  if (text !== localText) await $.fs.write(`${base}.feature`, text)
  if (JSON.stringify(list) !== JSON.stringify(local)) await $.fs.write(`${base}.evidence.json`, `${JSON.stringify(list, undefined, 2)}\n`)
  await publish($, name, ticket, text, list)
}

async function refreshBranch($: EngineInterface, name: string): Promise<void> {
  if (name === '') return
  const dirty = (await $.process.run(['git', 'status', '--porcelain'])).stdout.trim() !== ''
  const remote = repoUrl((await $.process.run(['git', 'remote', 'get-url', 'origin'])).stdout)
  const pr = await $.process.run(['gh', 'pr', 'view', '--json', 'url,state,isDraft,number'], { timeoutMs: 8000 }).catch(() => undefined)
  const parsed: unknown = (() => {
    try {
      return pr?.exitCode === 0 && pr.stdout.trim() !== '' ? JSON.parse(pr.stdout) : undefined
    } catch {
      return undefined
    }
  })()
  const view = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  const status: BranchStatus = view !== undefined ? prStatus(view.state, view.isDraft) : dirty ? 'dirty' : 'clean'
  const url = typeof view?.url === 'string' ? view.url : remote !== '' ? `${remote}/tree/${name}` : ''
  const info: BranchInfo = { name, status, url, pr: typeof view?.number === 'number' ? view.number : 0 }
  if (JSON.stringify((await $.state.get(BRANCH)).value) !== JSON.stringify(info)) await $.state.set(BRANCH, info)
}

type Draft = { kind: EvidenceKind; title: string; subtitle: string; scenario: string; detail: string; source: string }

async function keep($: EngineInterface, draftProof: Draft): Promise<void> {
  let proof = draftProof
  const { kind, title, scenario, detail, source } = proof
  const name = await currentName($)
  const base = `.claude/acceptance/${slug(name)}`
  const at = await $.clock.now()
  const dir = `${await $.session.cwd()}/${base}/proofs`
  await $.process.run(['mkdir', '-p', dir])
  let file = ''
  if (kind === 'artifact' && source !== '') {
    const html = await $.fs.read(source).catch(() => '')
    const named = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
    if (named !== undefined && named !== '') proof = { ...proof, subtitle: named }
  } else if (source !== '' && KEPT.test(source)) {
    const target = `${dir}/${at}-${source.split('/').pop() ?? 'proof'}`
    file = (await $.process.run(['cp', source, target])).exitCode === 0 ? target : ''
  }
  if (file === '' && kind !== 'artifact') {
    file = `${dir}/${at}-${fileSlug([title || GROUP_OF[kind], proof.subtitle].join(' '))}.txt`
    await $.fs.write(file, textProof(proof))
  }
  const draft: Evidence = {
    id: `${at}`,
    kind,
    title: title.slice(0, 160),
    subtitle: proof.subtitle.slice(0, 160),
    scenario: scenario.slice(0, 200),
    detail: detail.slice(0, 600),
    file,
    media: mediaOf(file),
    thumb: '',
    poster: '',
    large: '',
    width: 0,
    height: 0,
    remote: '',
    page: '',
    isSynced: false,
    at,
  }
  const thumbed = await withThumbnails($, draft)
  const local = { ...thumbed, page: '' }
  const config = await trackerConfig($)
  const ticket = ticketOf(config, name)
  const item = ticket !== '' && isReady(config) ? await pushProof($, config, ticket, local) : local
  const previous = await readJson($, `${base}.evidence.json`)
  const list = [...(Array.isArray(previous) ? (previous as Evidence[]) : []), item].slice(-200)
  await $.fs.write(`${base}.evidence.json`, `${JSON.stringify(list, undefined, 2)}\n`)
  await $.state.set(EVIDENCE, list)
}

function detect(tool: string, input: Record<string, unknown>, text: string): Draft | undefined {
  const found = detectRaw(tool, input, text)

  return found === undefined ? undefined : { kind: found[0], title: '', subtitle: found[1], scenario: '', detail: found[2], source: found[3] }
}

function detectRaw(tool: string, input: Record<string, unknown>, text: string): [EvidenceKind, string, string, string] | undefined {
  const command = typeof input.command === 'string' ? input.command : ''
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  const files = Array.isArray(input.files) ? input.files.filter((one): one is string => typeof one === 'string') : []
  const url = text.match(/https:\/\/claude\.ai\/\S*artifact\S*/)?.[0] ?? ''
  const runsCurl = /(?:^|[;&|(]\s*|&&\s*)curl\s/m.test(command) && !/Authorization:|youtrack\.cloud|dev\.azure\.com|visualstudio\.com/i.test(command)
  if (tool === 'Bash' && runsCurl) return ['curl', command, `$ ${command}\n\n${text}`, '']
  if (tool === 'Bash' && TEST_RUN.test(command)) return ['test', command, `$ ${command}\n\n${text.slice(-6000)}`, '']
  if (tool === 'Bash' && /screencapture|simctl io .*(screenshot|recordVideo)|playwright.*screenshot/.test(command)) {
    const shot = command.match(/(\S+\.(png|jpe?g|mp4|mov))/i)?.[1] ?? ''
    return [VIDEO.test(shot) ? 'video' : 'capture', shot.split('/').pop() ?? command, '', shot]
  }
  if (tool === 'Read' && (IMAGE.test(filePath) || VIDEO.test(filePath)) && !filePath.includes('.claude/acceptance/')) {
    return [VIDEO.test(filePath) ? 'video' : 'capture', filePath.split('/').pop() ?? filePath, '', filePath]
  }
  const named = typeof input.title === 'string' && input.title !== '' ? input.title : (filePath.split('/').pop() ?? '').replace(/\.[a-z]+$/i, '')
  const isPublish = (input.action === undefined || input.action === 'publish') && input.url === undefined && input.type_url === undefined
  if (tool === 'Artifact' && isPublish && filePath !== '' && !filePath.includes('/.claude/acceptance/') && input.asset !== true && url !== '') return ['artifact', named || url, url, filePath]
  if (tool === 'SendUserFile' && files.length > 0) return ['file', files.join(', '), typeof input.caption === 'string' ? input.caption : '', files[0] ?? '']
  return undefined
}

async function base64($: EngineInterface, path: string): Promise<string> {
  if (path === '') return ''
  const cached = thumbnails.get(path) ?? (await $.fs.read(path, { as: 'bytes' }).then(bytes => bytes.base64, () => ''))
  thumbnails.set(path, cached)

  return cached
}

function md(text: string): string {
  return text.replace(/([\\`*_[\]#<>|])/g, '\\$1')
}

const BLUE_CHIP = { fill: 'rgba(77,137,220,0.16)', hover: 'rgba(77,137,220,0.30)' }

type PageKind = keyof Pages

const PAGE_ICONS: Record<PageKind, string> = { ticket: 'ticket', rules: 'checklist', proofs: 'image' }

function hashOf(text: string): string {
  let hash = 0
  for (let at = 0; at < text.length; at += 1) hash = (hash * 31 + text.charCodeAt(at)) | 0
  return `${text.length}-${hash >>> 0}`
}

async function publishArtifact($: EngineInterface, kind: PageKind, path: string, url: string, files: Record<string, string>, title: string): Promise<string> {
  const input = url !== ''
    ? { tool: 'Artifact' as const, url, file_path: path, files }
    : { tool: 'Artifact' as const, file_path: path, files, icon: PAGE_ICONS[kind], description: title }
  const ran = await $.tool.call(input).catch(() => undefined)
  const text = ran === undefined ? '' : (ran.text ?? (typeof ran.result === 'string' ? ran.result : ''))

  return text.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/)?.[0] ?? url
}

async function readPages($: EngineInterface, base: string): Promise<Pages & { hashes: Record<string, string> }> {
  const stored = await readJson($, `${base}.pages.json`)
  const value = typeof stored === 'object' && stored !== null ? (stored as Partial<Pages & { hashes: Record<string, string> }>) : {}

  return { ticket: value.ticket ?? '', rules: value.rules ?? '', proofs: value.proofs ?? '', hashes: value.hashes ?? {} }
}

async function pageContent($: EngineInterface, name: string, links: PageLinks): Promise<{ ticket: string; rules: string; proofs: string; files: Record<string, string> }> {
  const branch = (await $.state.get(BRANCH)).value ?? NO_BRANCH
  const held = (await $.state.get(TICKET)).value ?? NO_TICKET
  const rules = parseRules((await $.state.get(CRITERIA)).value ?? '')
  const evidence = (await $.state.get(EVIDENCE)).value ?? []
  const proofsOf = (scenario: string) => evidence.filter(proof => sameName(proof.scenario, scenario))
  const scenarios = rules.subjects.flatMap(subject => subject.scenarios)
  const info: PageTicket = {
    id: labelOf(held.id),
    tracker: trackerName(await trackerConfig($)),
    url: held.url,
    summary: held.summary,
    context: held.context,
    branch: name,
    branchUrl: branch.url,
    status: branch.status,
    done: scenarios.filter(one => proofsOf(one.name).length > 0).length,
    total: scenarios.length,
    proofs: evidence.length,
  }
  const subjects: PageSubject[] = rules.subjects.map(subject => ({
    name: subject.name || 'Scénarios',
    scenarios: subject.scenarios.map(one => ({ name: one.name, steps: one.steps, proofs: proofsOf(one.name).map(proof => ({ id: proof.id, label: proof.subtitle || GROUP_OF[proof.kind] })) })),
  }))
  const files: Record<string, string> = {}
  const proofs: PageProof[] = []
  for (const item of evidence) {
    const fileName = item.file.split('/').pop() ?? ''
    if ((item.media === 'image' || item.media === 'video') && item.file !== '') files[`media/${fileName}`] = item.file
    proofs.push({
      id: item.id,
      kind: item.kind,
      media: item.kind === 'artifact' ? 'artifact' : item.media === 'image' || item.media === 'video' ? item.media : 'text',
      group: item.title || GROUP_OF[item.kind],
      subtitle: item.subtitle || GROUP_OF[item.kind],
      scenario: item.scenario,
      src: item.media === 'image' || item.media === 'video' ? `media/${fileName}` : fileName,
      text: item.media === 'text' ? await $.fs.read(item.file).catch(() => item.detail) : item.detail,
      link: item.kind === 'artifact' ? linkOf(item) : '',
    })
  }

  return { ticket: ticketPage(info, links), rules: rulesPage(info, rules.feature, subjects, links), proofs: proofsPage(info, proofs, links), files }
}

async function publishPages($: EngineInterface, name: string): Promise<void> {
  const held = (await $.state.get(TICKET)).value ?? NO_TICKET
  const config = await trackerConfig($)
  if (held.id === '' || (!isReady(config) && held.summary === '')) return
  const base = `.claude/acceptance/${slug(name)}`
  const cwd = await $.session.cwd()
  const stored = await readPages($, base)
  const links: Pages = { ticket: stored.ticket, rules: stored.rules, proofs: stored.proofs }
  const kinds: PageKind[] = ['ticket', 'rules', 'proofs']
  if (kinds.some(kind => links[kind] === '')) {
    const draft = await pageContent($, name, links)
    for (const kind of kinds) {
      if (links[kind] !== '') continue
      const path = `${cwd}/${base}.${kind}.html`
      await $.fs.write(path, draft[kind])
      links[kind] = await publishArtifact($, kind, path, '', kind === 'proofs' ? draft.files : {}, `${labelOf(held.id)} — ${kind === 'ticket' ? 'Ticket' : kind === 'rules' ? 'Règles' : 'Preuves'}`)
    }
  }
  const content = await pageContent($, name, links)
  const hashes: Record<string, string> = { ...stored.hashes }
  for (const kind of kinds) {
    const hash = hashOf(content[kind] + (kind === 'proofs' ? Object.keys(content.files).join(',') : ''))
    if (hashes[kind] === hash || links[kind] === '') continue
    const path = `${cwd}/${base}.${kind}.html`
    await $.fs.write(path, content[kind])
    await publishArtifact($, kind, path, links[kind], kind === 'proofs' ? content.files : {}, '')
    hashes[kind] = hash
  }
  await $.fs.write(`${base}.pages.json`, `${JSON.stringify({ ...links, hashes }, undefined, 2)}\n`)
  if (JSON.stringify((await $.state.get(PAGES)).value) !== JSON.stringify(links)) await $.state.set(PAGES, links)
}

async function openArtifact($: EngineInterface, url: string): Promise<void> {
  await $.tool.call({ tool: 'Artifact', action: 'open', url }).catch(() => $.ui.toast(`Impossible d’ouvrir ${url}`))
}

async function openFile($: EngineInterface, file: string): Promise<void> {
  const ran = await $.process.run(['open', file]).catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) $.ui.toast(`Impossible d’ouvrir ${file}`)
}

async function browse($: EngineInterface, url: string): Promise<void> {
  await $.tool.call({ tool: 'mcp__Claude_Browser__preview_start', url }).catch(() => $.ui.toast(`Navigateur intégré indisponible : ${url}`))
}

function proofLink(item: Evidence): string {
  if (item.kind === 'artifact') return linkOf(item)
  return item.page !== '' ? item.page : fileUrl(item.file)
}

function fileUrl(path: string): string {
  return `file://${encodeURI(path)}`
}

function scenarioMarkdown(name: string, steps: string[], proofs: Evidence[]): string {
  const lines = steps.map(step => {
    const keyword = step.match(/^\S+/)?.[0] ?? ''
    return `  *${md(keyword)}*${md(step.slice(keyword.length))}`
  })
  if (proofs.length === 0) lines.push('  _En attente de preuve_')

  return `${proofs.length > 0 ? '✓' : '○'} **${md(name)}**  \n${lines.join('  \n')}`
}

const CRITERIA_TOOL = 'save_acceptance_criteria'
const CREATE_TOOL = 'create_ticket'
const USE_TOOL = 'use_ticket'
const BRANCH_CREATE = /git\s+(?:checkout\s+-b|switch\s+(?:-c|--create)|branch(?!\s+-)|worktree\s+add\s+(?:\S+\s+)*?-b)\s+([^\s;&|]+)/

function criteriaPath(branch: string): string {
  return `.claude/acceptance/${slug(branch)}.feature`
}

async function artifactLinks($: EngineInterface, branch: string, label: string): Promise<string> {
  const stored = await readPages($, `.claude/acceptance/${slug(branch)}`)
  const lines = [
    stored.ticket !== '' ? `- ${label} — Ticket : ${stored.ticket}` : '',
    stored.rules !== '' ? `- ${label} — Règles : ${stored.rules}` : '',
    stored.proofs !== '' ? `- ${label} — Preuves : ${stored.proofs}` : '',
  ].filter(Boolean)

  return label === '' || lines.length === 0 ? '' : `\n\nArtefacts du ticket, à citer dans le résumé final :\n${lines.join('\n')}`
}

async function required($: EngineInterface, config: TrackerConfig, request: HttpRequest): Promise<unknown> {
  if (!isReady(config)) throw new Error(`${trackerName(config)} n'est pas configuré (URL, jeton${config.kind === 'azure-devops' ? ', projet' : ''})`)
  const response = await $.http.fetch(request.url, { method: request.method, headers: request.headers, body: request.body })
  if (!response.ok) throw new Error(`${trackerName(config)} ${response.status} : ${response.text.slice(0, 200)}`)

  return JSON.parse(response.text || '{}')
}

async function pushRules($: EngineInterface, config: TrackerConfig, id: string, feature: string): Promise<void> {
  const issue = issueOf(config, await required($, config, issueRequest(config, id)), undefined)
  await required($, config, descriptionRequest(config, id, withRules(config, issue.description, feature)))
}

async function projectIdOf($: EngineInterface, config: TrackerConfig, project: string): Promise<string> {
  if (config.kind === 'azure-devops') return config.project
  const list = await required($, config, projectsRequest(config))
  const found = (Array.isArray(list) ? (list as { id?: string; shortName?: string }[]) : []).find(one => one.shortName === project)

  return found?.id ?? ''
}

async function switchTo($: EngineInterface, branch: string): Promise<string> {
  const exists = (await $.process.run(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).exitCode === 0
  const ran = await $.process.run(exists ? ['git', 'switch', branch] : ['git', 'switch', '-c', branch])

  return ran.exitCode === 0 ? `branche ${branch} ${exists ? 'reprise' : 'créée'}` : `branche ${branch} non basculée : ${ran.stderr.trim()}`
}

function projectHint(config: TrackerConfig): string {
  if (config.kind === 'azure-devops') return `dans le projet Azure DevOps ${config.project || '(à configurer)'}`
  if (config.projects.length === 0) return 'dans le projet YouTrack qui convient (demande en cas de doute)'

  return `dans l'un des projets ${config.projects.join(', ')} (${config.projects[0] ?? ''} par défaut ; demande en cas de doute)`
}

function policy(config: TrackerConfig): string {
  const example = `feature/${exampleId(config)}`

  return `# Critères d'acceptation, ticket et branche (plugin acceptance)

Avant d'écrire du code pour une demande de fonctionnalité, de correction ou de changement de comportement :

1. Reformule la demande en critères d'acceptation Gherkin (Feature / Rule / Scenario / Given / When / Then, mots-clés anglais), cas nominal, cas limites et cas d'erreur inclus. Regroupe les scénarios par sujet sous des \`Rule: <sujet>\` : l'artefact Règles en fait une checklist par sujet.
2. Signale les ambiguïtés et pose les questions qui changent les critères ; propose pour chacune une réponse par défaut.
3. Négocie : présente les scénarios, ajuste-les selon les retours, et attends un accord explicite avant d'implémenter.
4. Ticket (${trackerName(config)}) : si la branche ne porte pas de numéro de ticket, crée-le avec mcp__acceptance__${CREATE_TOOL} ${projectHint(config)}, avec un contexte complet : la demande, le pourquoi, les décisions de la négociation. Pour reprendre un ticket existant, mcp__acceptance__${USE_TOOL}. Les deux basculent sur la branche feature/<ID> (fix/<ID> pour un bug), par exemple ${example} : ne crée jamais de branche sans numéro de ticket.
5. Enregistre les règles validées avec mcp__acceptance__${CRITERIA_TOOL} : elles vont dans la description du ticket. Renégocie et réenregistre si elles changent.
6. Chaque preuve passe par mcp__acceptance__${TOOL} avec un titre de groupe (surface et contexte : « Web — Calendrier mobile »), un sous-titre (la variante : « sans publication »), le nom exact du Scenario qu'elle satisfait (il se coche dans Règles) et le chemin du fichier pour une capture ou une vidéo. Elle est jointe au ticket.
7. À la fin, rapporte scénario par scénario s'il est satisfait et par quelle preuve. Ton résumé final liste toujours les artefacts du ticket, chacun par son nom exact et son lien : « <ID> — Ticket », « <ID> — Règles », « <ID> — Preuves ».

Une question, une lecture ou une modification triviale n'exige ni négociation ni ticket.`
}

async function registerInputTools($: EngineInterface, config: TrackerConfig): Promise<void> {
  const name = trackerName(config)
  await $.tool.register({
    name: CRITERIA_TOOL,
    description: `Enregistre les critères d'acceptation Gherkin validés pour la branche courante, localement et dans la description de son ticket ${name} (remplace la version précédente).`,
    inputSchema: {
      type: 'object',
      properties: { feature: { type: 'string', description: 'Le texte Gherkin complet (Feature, Scenario, Given/When/Then).' } },
      required: ['feature'],
    },
    isDeferred: false,
  })
  const project = config.kind === 'youtrack' && config.projects.length > 0 ? { type: 'string', enum: config.projects } : { type: 'string', description: config.kind === 'youtrack' ? 'Le nom court du projet YouTrack.' : 'Ignoré : le projet Azure DevOps vient de la configuration.' }
  await $.tool.register({
    name: CREATE_TOOL,
    description: `Crée le ticket ${name} de la demande (contexte complet, plus les règles déjà validées) et bascule sur la branche feature/<ID> ou fix/<ID>.`,
    inputSchema: {
      type: 'object',
      properties: {
        project,
        summary: { type: 'string', description: 'Titre court du ticket.' },
        context: { type: 'string', description: 'Markdown : la demande, le pourquoi, les décisions prises, les contraintes.' },
        kind: { type: 'string', enum: ['feature', 'fix'], description: 'Préfixe de la branche ; feature par défaut.' },
      },
      required: config.kind === 'youtrack' ? ['project', 'summary', 'context'] : ['summary', 'context'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: USE_TOOL,
    description: `Reprend un ticket ${name} existant (ex. ${exampleId(config)}) : bascule sur sa branche feature/<ID> ou fix/<ID> ; règles et preuves sont relues depuis le ticket.`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['feature', 'fix'] } },
      required: ['id'],
    },
    isDeferred: false,
  })
  await $.command.register({ name: 'criteres', description: "Affiche le ticket et les critères d'acceptation de la branche courante" })
}

async function saveCriteria($: EngineInterface, raw: unknown): Promise<{ result: string } | { deny: string }> {
  const feature = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\s*(Feature|Fonctionnalité)\s*:/m.test(feature) || !/^\s*(Scenario|Scénario)/m.test(feature)) {
    return { deny: 'Le texte doit contenir une ligne "Feature:" et au moins un "Scenario:".' }
  }
  const config = await trackerConfig($)
  const branch = await currentName($)
  const path = criteriaPath(branch)
  await $.fs.write(path, `${feature}\n`)
  const ticket = ticketOf(config, branch)
  if (ticket === '') return { result: `Critères enregistrés dans ${path}. Aucun ticket : crée-le pour qu'ils y soient copiés.` }
  const label = displayId(config, ticket)
  const synced = await pushRules($, config, ticket, feature).then(
    () => `et dans la description de ${label}`,
    (error: unknown) => `mais pas dans ${label} (${String(error)})`,
  )

  return { result: `Critères enregistrés dans ${path} ${synced}.` }
}

async function createTicket($: EngineInterface, input: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const config = await trackerConfig($)
  const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
  const context = typeof input.context === 'string' ? input.context.trim() : ''
  const project = typeof input.project === 'string' ? input.project.trim() : (config.projects[0] ?? '')
  if (summary === '' || context === '') return { deny: 'Titre et contexte sont obligatoires.' }
  const branch = await currentName($)
  const existing = ticketOf(config, branch)
  if (existing !== '') return { deny: `La branche ${branch} a déjà son ticket ${displayId(config, existing)}.` }
  const projectId = await projectIdOf($, config, project).catch(() => '')
  if (projectId === '') return { deny: `Projet introuvable : ${project || '(aucun)'}${config.projects.length > 0 ? ` (${config.projects.join(', ')})` : ''}.` }
  const local = criteriaPath(branch)
  const feature = (await $.fs.exists(local)) ? await $.fs.read(local) : ''
  const created = await required($, config, createRequest(config, projectId, summary, descriptionFor(config, context, feature))).catch((error: unknown) => String(error))
  const id = typeof created === 'string' ? '' : createdIdOf(config, created)
  if (id === '') return { deny: `Ticket non créé : ${typeof created === 'string' ? created : "aucun identifiant rendu"}.` }
  const target = `${input.kind === 'fix' ? 'fix' : 'feature'}/${id}`
  const switched = await switchTo($, target)
  if (feature !== '') await $.fs.write(criteriaPath(target), feature)

  return { result: `Ticket ${displayId(config, id)} créé (${issueUrl(config, id)}) ; ${switched}.` }
}

async function useTicket($: EngineInterface, input: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const config = await trackerConfig($)
  const id = typeof input.id === 'string' ? input.id.trim().replace(/^#/, '') : ''
  if (!isTicketId(config, id)) return { deny: `L'identifiant doit ressembler à ${exampleId(config)}.` }
  const issue = await required($, config, issueRequest(config, id)).then(
    response => issueOf(config, response, undefined),
    () => undefined,
  )
  if (issue === undefined) return { deny: `Ticket ${displayId(config, id)} introuvable.` }

  return { result: `Ticket ${displayId(config, id)} : ${issue.summary} ; ${await switchTo($, `${input.kind === 'fix' ? 'fix' : 'feature'}/${id}`)}.` }
}

export const register: Register = (on, options) => {
  OPTIONS = options

  on('session.start', async ($, e, next) => {
    await registerInputTools($, await trackerConfig($))
    await $.tool.register({
      name: TOOL,
      description:
        "Ajoute une preuve (capture, vidéo, cURL, artefact, fichier…) qui démontre qu'un critère d'acceptation est satisfait : conservée localement et jointe au ticket de la branche. Nomme le scénario prouvé dans le titre.",
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          title: { type: 'string', description: 'Titre de groupe : la surface et le contexte, ex. « Web — Calendrier mobile », « Web — Calendrier tablette », « API — Publication ».' },
          subtitle: { type: 'string', description: 'Sous-titre : la variante montrée, ex. « sans publication », « avec 2 publications le même jour ».' },
          scenario: { type: 'string', description: 'Le nom exact du Scenario Gherkin que la preuve satisfait (coche la règle).' },
          detail: { type: 'string', description: 'Pour une preuve texte (cURL, test) : la commande et sa sortie complète, enregistrées dans un .txt joint au ticket. Pour un artefact : son URL.' },
          path: { type: 'string', description: 'Le fichier de la preuve : obligatoire pour une capture ou une vidéo (enregistre-la d’abord sur disque). Absent, detail devient un fichier .txt, sauf pour un artefact qui reste un lien.' },
        },
        required: ['kind', 'title'],
      },
      isDeferred: false,
    })
    const name = await refreshLocal($)
    await syncTicket($, name)
    await refreshBranch($, name)
    await publishPages($, name)

    return next(e)
  })

  on('tool.call', { tool: `mcp__acceptance__${TOOL}` }, async ($, e) => {
    const kind = KINDS.find(one => one === e.kind) ?? 'other'
    const title = typeof e.title === 'string' ? e.title : ''
    if (title === '') return { deny: 'Le titre est obligatoire.' }
    const text = (value: unknown) => (typeof value === 'string' ? value : '')
    await keep($, { kind, title, subtitle: text(e.subtitle), scenario: text(e.scenario), detail: text(e.detail), source: text(e.path) })
    await refreshLocal($)
    const list = (await $.state.get(EVIDENCE)).value ?? []
    const isSynced = list[list.length - 1]?.isSynced === true

    return { result: isSynced ? 'Preuve conservée et jointe au ticket.' : 'Preuve conservée ; elle rejoindra le ticket dès que la branche en aura un.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const before = ((await $.state.get(BRANCH)).value ?? NO_BRANCH).name
    if (ran.deny === undefined && ran.isError === undefined && !e.tool.startsWith('mcp__acceptance__')) {
      const found = detect(e.tool, e as unknown as Record<string, unknown>, ran.text ?? (typeof ran.result === 'string' ? ran.result : ''))
      if (found !== undefined) await keep($, found)
    }
    const name = await refreshLocal($)
    if (name !== before) await syncTicket($, name)
    if (e.tool === 'Bash' || name !== before) await refreshBranch($, name)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin !== undefined) return next(e)
    const config = await trackerConfig($)
    const branch = await currentName($)
    const ticket = ticketOf(config, branch)
    const label = displayId(config, ticket)
    const rules = (await $.fs.exists(criteriaPath(branch))) ? 'Des règles validées existent (artefact Règles, description du ticket).' : 'Aucune règle validée.'
    const tracked = ticket !== '' ? `Branche ${branch}, ticket ${label} (${issueUrl(config, ticket)}).` : `Branche ${branch || '(détachée)'} sans ticket.`
    const setup = isReady(config) ? '' : `\n\nLe gestionnaire de tickets n'est pas configuré : propose à l'utilisateur de renseigner les options du plugin acceptance (/config).`

    return next({ ...e, context: [...(e.context ?? []), `${policy(config)}\n\n${tracked} ${rules}${await artifactLinks($, branch, label)}${setup}`] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = typeof e.command === 'string' ? e.command : ''
    const created = command.match(BRANCH_CREATE)?.[1]
    const config = await trackerConfig($)
    if (created !== undefined && ticketOf(config, created) === '') {
      return { deny: `Une branche porte le numéro de son ticket (feature/${exampleId(config)}) : crée d'abord le ticket avec mcp__acceptance__${CREATE_TOOL}.` }
    }

    return next(e)
  })

  on('tool.call', { tool: `mcp__acceptance__${CRITERIA_TOOL}` }, async ($, e) => saveCriteria($, e.feature))

  on('tool.call', { tool: `mcp__acceptance__${CREATE_TOOL}` }, async ($, e) => createTicket($, e as unknown as Record<string, unknown>))

  on('tool.call', { tool: `mcp__acceptance__${USE_TOOL}` }, async ($, e) => useTicket($, e as unknown as Record<string, unknown>))

  on('command.run', { command: 'criteres' }, async $ => {
    const config = await trackerConfig($)
    const branch = await currentName($)
    const path = criteriaPath(branch)
    const ticket = ticketOf(config, branch)
    const rules = (await $.fs.exists(path)) ? await $.fs.read(path) : `Aucun critère enregistré (${path}).`

    return { text: `${ticket !== '' ? `Ticket ${displayId(config, ticket)} : ${issueUrl(config, ticket)}\n\n` : ''}${rules}` }
  })

  on('turn.complete', async ($, e, next) => {
    const name = await refreshLocal($)
    await syncTicket($, name)
    await refreshBranch($, name)
    await publishPages($, name)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ticket = (await $.state.get(TICKET)).value ?? NO_TICKET
    const pages = (await $.state.get(PAGES)).value ?? NO_PAGES
    const rules = parseRules((await $.state.get(CRITERIA)).value ?? '')
    const evidence = (await $.state.get(EVIDENCE)).value ?? []
    const all = rules.subjects.flatMap(subject => subject.scenarios)
    const done = all.filter(one => evidence.some(proof => sameName(proof.scenario, one.name))).length
    if (ticket.id === '' && all.length === 0 && evidence.length === 0) return next(e)
    const table = $.ui.resolve(e)
    const { Box, Button } = table
    const Markdown = 'Markdown' in table ? table.Markdown : undefined
    const open = (url: string, fallback: string, title: string) => () =>
      void (url !== '' ? openArtifact($, url) : fallback !== '' ? $.ui.open({ id: fallback, title }) : browse($, ticket.url))
    const link = (key: string, url: string, label: string, press: () => void) =>
      Markdown !== undefined && url !== '' ? (
        <Box key={key}>
          <Markdown key={`${key}-link`} text={`[${md(label)}](${url})`} />
        </Box>
      ) : (
        <Button key={key} variant="secondary" onPress={press}>
          {label}
        </Button>
      )

    return (
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        {ticket.id !== '' && link('ticket', pages.ticket, `Ticket ${labelOf(ticket.id)}`, open(pages.ticket, '', 'Ticket'))}
        <Box flexGrow={1} />
        {all.length > 0 && link('rules', pages.rules, `Règles ${done}/${all.length}`, open(pages.rules, RULES, 'Règles'))}
        {evidence.length > 0 && link('proofs', pages.proofs, `Preuves ${evidence.length}`, open(pages.proofs, PROOFS, 'Preuves'))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: RULES }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const Markdown = 'Markdown' in table ? table.Markdown : undefined
    const rules = parseRules((await $.state.get(CRITERIA)).value ?? '')
    const evidence = (await $.state.get(EVIDENCE)).value ?? []
    const ticket = (await $.state.get(TICKET)).value ?? NO_TICKET
    const collapsed = (await $.state.get(COLLAPSED)).value ?? []
    const proofsOf = (name: string) => evidence.filter(proof => sameName(proof.scenario, name))
    const all = rules.subjects.flatMap(subject => subject.scenarios)
    const done = all.filter(one => proofsOf(one.name).length > 0).length
    const waiting = all.length - done
    const toggle = (name: string) =>
      void $.state.set(COLLAPSED, collapsed.includes(name) ? collapsed.filter(one => one !== name) : [...collapsed, name])
    const summary = `${done} sur ${all.length} prouvés · ${waiting === 0 ? 'tout est prouvé' : `${waiting} à prouver`}${ticket.id !== '' ? ` · [${md(labelOf(ticket.id))}](${ticket.url})` : ''}`

    return (
      <Box flexDirection="column" gap={1}>
        {all.length === 0 && <Text dimColor>Aucune règle validée pour cette branche.</Text>}
        {all.length > 0 && (
          <Box flexDirection="row" gap={2} alignItems="center">
            {Svg !== undefined && <Svg source={ring(done, all.length)} alt={`${done} scénarios prouvés sur ${all.length}`} width={40} height={40} />}
            <Box flexDirection="column" flexGrow={1}>
              <Text weight="semibold">{rules.feature || 'Règles'}</Text>
              {Markdown !== undefined ? <Markdown text={summary} dimColor /> : <Text size="footnote" dimColor>{summary}</Text>}
            </Box>
          </Box>
        )}
        {rules.subjects.map(subject => {
          const name = subject.name || 'Scénarios'
          const isOpen = !collapsed.includes(name)
          const proven = subject.scenarios.filter(one => proofsOf(one.name).length > 0).length
          const tone = proven === subject.scenarios.length ? THEME.done : proven > 0 ? THEME.partial : THEME.muted
          return (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Button key={`subject-${name}`} plain onPress={() => toggle(name)}>
                <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
                <Text weight="semibold">{name}</Text>
                <Text color={tone}>{`  ${proven}/${subject.scenarios.length}`}</Text>
              </Button>
              {isOpen &&
                subject.scenarios.map(scenario => {
                  const proofs = proofsOf(scenario.name)
                  const text = scenarioMarkdown(scenario.name, scenario.steps, proofs)
                  return (
                    <Box flexDirection="column" gap={1} paddingLeft={2}>
                      {Markdown !== undefined ? <Markdown text={text} /> : <Text>{text}</Text>}
                      {proofs.length > 0 && (
                        <Box flexDirection="row" flexWrap="wrap" gap={2} paddingLeft={2}>
                          {Markdown !== undefined ? (
                            <Markdown key={`proofs-${scenario.name}`} text={proofs.map(proof => `[${md(proof.subtitle || GROUP_OF[proof.kind])}](${proofLink(proof)})`).join('   ')} />
                          ) : (
                            proofs.map(proof => (
                              <Button key={`proof-${proof.id}`} variant="secondary" onPress={() => void openFile($, proof.file)}>
                                <Text color={THEME.done}>{`${GLYPH[proof.media]} ${proof.subtitle || GROUP_OF[proof.kind]}`}</Text>
                              </Button>
                            ))
                          )}
                        </Box>
                      )}
                    </Box>
                  )
                })}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PROOFS }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Code, Text } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const Markdown = 'Markdown' in table ? table.Markdown : undefined
    const list = (await $.state.get(EVIDENCE)).value ?? []
    const ticket = (await $.state.get(TICKET)).value ?? NO_TICKET
    const visuals = list.filter(item => item.media === 'image' || item.media === 'video')
    const texts = list.filter(item => item.media === 'text' || item.media === 'pdf' || (item.media === '' && item.kind !== 'artifact'))
    const artifacts = list.filter(item => item.kind === 'artifact')
    const tileWidth = Math.max(110, Math.min(170, Math.floor((e.props.bodyColumns * 7.6 - 24) / 2)))
    const tileHeight = Math.round(tileWidth * 1.15)
    const tiles = new Map<string, string>()
    for (const item of visuals) {
      const data = Svg !== undefined ? await base64($, item.thumb) : ''
      if (data !== '') tiles.set(item.id, cropped(item, data, tileWidth, tileHeight))
    }
    const files = list.length - artifacts.length
    const excerpt = (item: Evidence) => item.detail.split('\n').filter(line => !line.startsWith('#')).join('\n').trim().split('\n').slice(0, 6).join('\n')
    const markdown = (text: string, dim = false) => (Markdown !== undefined ? <Markdown text={text} dimColor={dim} /> : <Text dimColor={dim}>{text}</Text>)
    const heading = (title: string, count: number) => markdown(`#### ${md(title)} · ${count}`)
    const criteria = parseRules((await $.state.get(CRITERIA)).value ?? '')
    const stepsOf = (name: string) => criteria.subjects.flatMap(subject => subject.scenarios).find(one => sameName(one.name, name))?.steps ?? []
    const subjectOf = (name: string) => criteria.subjects.find(subject => subject.scenarios.some(one => sameName(one.name, name)))?.name ?? 'Règle'
    const ruleBadge = (item: Evidence) => {
      if (item.scenario === '') return undefined
      const chipTone = BLUE_CHIP
      const link = ticket.url !== '' ? ticket.url : ''
      return (
        <Box key={`goto-rule-${item.id}`} position="relative" flexDirection="row" alignItems="center" paddingX={1} backgroundColor={chipTone.fill} borderStyle="round" borderColor={chipTone.fill} hover={{ backgroundColor: chipTone.hover, borderColor: chipTone.hover }}>
          {Markdown !== undefined && link !== '' ? <Markdown text={`[§ ${md(item.scenario)}](${link})`} /> : <Text color="suggestion">{`§ ${item.scenario}`}</Text>}
          <Box position="absolute" top={2} left={0} display="none" hover={{ display: 'flex' }} flexDirection="column" paddingX={1} borderStyle="round" borderColor="#3A3936" backgroundColor="#1F1E1D" width={Math.max(220, Math.min(320, e.props.bodyColumns * 7))}>
            <Text size="footnote" color="#A5A29A">{`Règle · ${subjectOf(item.scenario)}`}</Text>
            {stepsOf(item.scenario).map(step => (
              <Text color="#ECEAE3">{step}</Text>
            ))}
          </Box>
        </Box>
      )
    }
    const proofBadge = (item: Evidence) =>
      Markdown !== undefined ? (
        <Markdown key={`open-${item.id}`} text={`[${md(item.subtitle || item.title || GROUP_OF[item.kind])}](${proofLink(item)})`} />
      ) : (
        <Button key={`open-${item.id}`} variant="secondary" onPress={() => void openFile($, item.file)}>
          <Text color={THEME.done}>{`${GLYPH[item.media]} ${item.subtitle || item.title || GROUP_OF[item.kind]}`}</Text>
        </Button>
      )
    const header = `${files} fichier${files > 1 ? 's' : ''}${artifacts.length > 0 ? ` · ${artifacts.length} artefact${artifacts.length > 1 ? 's' : ''}` : ''}${ticket.id !== '' ? ` · [${md(labelOf(ticket.id))}](${ticket.url})` : ''}`

    return (
      <Box flexDirection="column" gap={1}>
        {markdown(header, true)}
        {list.length === 0 && <Text dimColor>Aucune preuve pour cette branche.</Text>}
        {grouped(visuals).map(([title, items]) => (
          <Box flexDirection="column" gap={1}>
            {heading(title, items.length)}
            <Box flexDirection="row" flexWrap="wrap" gap={2}>
              {items.map(item => (
                <Box key={`tile-${item.id}`} flexDirection="column" gap={0} width={tileWidth}>
                  {Svg !== undefined && tiles.has(item.id) && <Svg source={tiles.get(item.id) ?? ''} alt={item.subtitle || item.title} width={tileWidth} height={tileHeight} />}
                  <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
                    {proofBadge(item)}
                    {ruleBadge(item)}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        {texts.length > 0 && heading('Requêtes et tests', texts.length)}
        {texts.map(item => (
          <Box key={`text-${item.id}`} flexDirection="column" gap={0}>
            {excerpt(item) !== '' && <Code source={excerpt(item)} language={item.kind === 'curl' ? 'http' : 'bash'} path={item.file.split('/').pop() ?? ''} />}
            <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
              {proofBadge(item)}
              {ruleBadge(item)}
            </Box>
          </Box>
        ))}
        {artifacts.length > 0 && heading('Artefacts', artifacts.length)}
        {artifacts.map(item => (
          <Box key={`artifact-${item.id}`} flexDirection="column" gap={1}>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {proofBadge(item)}
              {ruleBadge(item)}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
