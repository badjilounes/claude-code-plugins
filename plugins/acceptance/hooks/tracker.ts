export type TrackerKind = 'youtrack' | 'azure-devops'

export type TrackerConfig = {
  kind: TrackerKind
  url: string
  project: string
  workItemType: string
  projects: string[]
  token: string
}

export type HttpRequest = { method: string; url: string; headers: Record<string, string>; body?: string }

export type Issue = { summary: string; description: string; rules: string; context: string; comments: string[]; attachments: { name: string; url: string }[] }

const YOUTRACK_ID = /\b[A-Z][A-Z0-9]+-\d+\b/
const AZURE_ID = /(?:^|\/)(\d+)(?=$|[-_/.])/
const RULES_HEADING = "Règles d'acceptation"
const MARKDOWN_RULES = /## Règles d'acceptation\s*```gherkin\n([\s\S]*?)```/
const HTML_RULES = /<h2>\s*Règles d(?:'|&#39;|’)acceptation\s*<\/h2>\s*<pre[^>]*>([\s\S]*?)<\/pre>/i
const PROOF_MARK = /acceptance-proof:([A-Za-z0-9_-]+)/
const LEGACY_MARK = /<!-- acceptance-proof:(\{[\s\S]*?\}) -->/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const TRACKER_NAMES: Record<TrackerKind, string> = { youtrack: 'YouTrack', 'azure-devops': 'Azure DevOps' }
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function trackerName(config: TrackerConfig): string {
  return TRACKER_NAMES[config.kind]
}

export function safeFileName(name: string): string {
  return SAFE_FILE.test(name) && !name.includes('..') ? name : ''
}

export function isProofId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

export function isTrackerUrl(config: TrackerConfig, url: string): boolean {
  try {
    const target = new URL(url)
    const home = new URL(config.url)
    return target.protocol === 'https:' && target.origin === home.origin
  } catch {
    return false
  }
}

export function curlString(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function curlLines(entries: [string, string][]): string[] {
  const lines = entries.map(([key, value]) => {
    const quoted = curlString(value)
    return quoted === undefined ? undefined : `${key} = ${quoted}`
  })
  return lines.every(line => line !== undefined) ? (lines as string[]) : []
}

export function configOf(options: Readonly<Record<string, unknown>>, envToken: string): TrackerConfig {
  const kind: TrackerKind = options.tracker === 'azure-devops' ? 'azure-devops' : 'youtrack'

  return {
    kind,
    url: text(options.trackerUrl).replace(/\/+$/, ''),
    project: text(options.azureProject),
    workItemType: text(options.azureWorkItemType) || 'User Story',
    projects: text(options.projects)
      .split(',')
      .map(one => one.trim())
      .filter(Boolean),
    token: text(options.token) || envToken.trim(),
  }
}

export const SETTINGS_FILE = '.claude/acceptance.json'

export type TrackerSettings = { tracker: TrackerKind; trackerUrl: string; projects: string; azureProject: string; azureWorkItemType: string }

export function normalizedUrl(raw: string): string {
  if (/[\\\s@]/.test(raw)) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return ''
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function settingsOf(args: string): TrackerSettings | string {
  const [url = '', target = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const trackerUrl = normalizedUrl(url)
  if (trackerUrl === '') return "L'URL du tracker doit être une adresse https simple, sans identifiants, requête ni fragment (ex. https://<org>.youtrack.cloud)."
  const azure = /(^|\.)(dev\.azure\.com|visualstudio\.com)$/i.test(new URL(trackerUrl).hostname)
  if (azure && target === '') return 'Azure DevOps : précise le projet après l\'URL.'

  return azure
    ? { tracker: 'azure-devops', trackerUrl, projects: '', azureProject: target, azureWorkItemType: rest.join(' ') || 'User Story' }
    : { tracker: 'youtrack', trackerUrl, projects: target, azureProject: '', azureWorkItemType: '' }
}

export function isReady(config: TrackerConfig): boolean {
  return config.url !== '' && config.token !== '' && (config.kind === 'youtrack' || config.project !== '')
}

export function ticketOf(config: TrackerConfig, branch: string): string {
  if (config.kind === 'azure-devops') return branch.match(AZURE_ID)?.[1] ?? ''
  return branch.match(YOUTRACK_ID)?.[0] ?? ''
}

export function isTicketId(config: TrackerConfig, id: string): boolean {
  return config.kind === 'azure-devops' ? /^\d+$/.test(id) : /^[A-Z][A-Z0-9]+-\d+$/.test(id)
}

export function displayId(config: TrackerConfig, id: string): string {
  return config.kind === 'azure-devops' ? labelOf(id) : id
}

export function labelOf(id: string): string {
  return /^\d+$/.test(id) ? `#${id}` : id
}

export function issueUrl(config: TrackerConfig, id: string): string {
  if (id === '' || config.url === '') return ''
  if (config.kind === 'azure-devops') return `${config.url}/${encodeURIComponent(config.project)}/_workitems/edit/${id}`
  return `${config.url}/issue/${id}`
}

export function exampleId(config: TrackerConfig): string {
  return config.kind === 'azure-devops' ? '1234' : `${config.projects[0] ?? 'PROJ'}-42`
}

function base64(textValue: string): string {
  const bytes = new TextEncoder().encode(textValue)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return new TextDecoder().decode(bytes)
}

export function authHeader(config: TrackerConfig): string {
  return config.kind === 'azure-devops' ? `Basic ${base64(`:${config.token}`)}` : `Bearer ${config.token}`
}

function azureApi(config: TrackerConfig, path: string): string {
  return `${config.url}/${encodeURIComponent(config.project)}/_apis/wit/${path}`
}

function json(config: TrackerConfig, method: string, url: string, body?: unknown, contentType = 'application/json'): HttpRequest {
  return {
    method,
    url,
    headers: { Authorization: authHeader(config), Accept: 'application/json', 'Content-Type': contentType },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function htmlToText(value: string): string {
  return unescapeHtml(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function markdownToHtml(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.split('\n')
      if (lines.every(line => /^\s*[-*] /.test(line))) return `<ul>${lines.map(line => `<li>${escapeHtml(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`
      const heading = block.match(/^(#{1,4})\s+(.*)$/)
      if (heading !== null && lines.length === 1) return `<h${(heading[1] ?? '#').length + 1}>${escapeHtml(heading[2] ?? '')}</h${(heading[1] ?? '#').length + 1}>`
      return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}

export function rulesBlock(config: TrackerConfig, feature: string): string {
  if (config.kind === 'azure-devops') return `<h2>${RULES_HEADING}</h2><pre>${escapeHtml(feature.trim())}</pre>`
  return `## ${RULES_HEADING}\n\n\`\`\`gherkin\n${feature.trim()}\n\`\`\``
}

export function withRules(config: TrackerConfig, description: string, feature: string): string {
  const pattern = config.kind === 'azure-devops' ? HTML_RULES : MARKDOWN_RULES
  const block = rulesBlock(config, feature)
  if (pattern.test(description)) return description.replace(pattern, block)

  return config.kind === 'azure-devops' ? `${description}${block}` : `${description.trim()}\n\n${block}`.trim()
}

export function descriptionFor(config: TrackerConfig, context: string, feature: string): string {
  const body = config.kind === 'azure-devops' ? markdownToHtml(context) : context

  return feature.trim() === '' ? body : withRules(config, body, feature)
}

export function rulesOf(config: TrackerConfig, description: string): string {
  if (config.kind === 'azure-devops') return unescapeHtml(description.match(HTML_RULES)?.[1] ?? '').trim()
  return description.match(MARKDOWN_RULES)?.[1]?.trim() ?? ''
}

export function contextOf(config: TrackerConfig, description: string): string {
  if (config.kind === 'azure-devops') return htmlToText(description.replace(HTML_RULES, ''))
  return description.replace(MARKDOWN_RULES, '').trim()
}

export function proofMarker(value: unknown): string {
  return `\`acceptance-proof:${base64(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}\``
}

export function proofOf(comment: string): unknown {
  const encoded = comment.match(PROOF_MARK)?.[1]
  if (encoded !== undefined) {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    try {
      return JSON.parse(fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4)))
    } catch {
      return undefined
    }
  }
  const legacy = comment.match(LEGACY_MARK)?.[1]
  if (legacy === undefined) return undefined
  try {
    return JSON.parse(legacy)
  } catch {
    return undefined
  }
}

export function projectsRequest(config: TrackerConfig): HttpRequest {
  return json(config, 'GET', `${config.url}/api/admin/projects?fields=id,shortName`)
}

export function createRequest(config: TrackerConfig, projectId: string, summary: string, description: string): HttpRequest {
  if (config.kind === 'azure-devops') {
    return json(
      config,
      'POST',
      azureApi(config, `workitems/$${encodeURIComponent(config.workItemType)}?api-version=7.1`),
      [
        { op: 'add', path: '/fields/System.Title', value: summary },
        { op: 'add', path: '/fields/System.Description', value: description },
      ],
      'application/json-patch+json',
    )
  }
  return json(config, 'POST', `${config.url}/api/issues?fields=idReadable`, { project: { id: projectId }, summary, description })
}

export function createdIdOf(config: TrackerConfig, response: unknown): string {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  if (config.kind === 'azure-devops') return value.id === undefined ? '' : String(value.id)
  return text(value.idReadable)
}

export function issueRequest(config: TrackerConfig, id: string): HttpRequest {
  if (config.kind === 'azure-devops') return json(config, 'GET', azureApi(config, `workitems/${id}?$expand=relations&api-version=7.1`))
  return json(config, 'GET', `${config.url}/api/issues/${id}?fields=idReadable,summary,description,comments(text),attachments(name,url)`)
}

export function commentsRequest(config: TrackerConfig, id: string): HttpRequest | undefined {
  return config.kind === 'azure-devops' ? json(config, 'GET', azureApi(config, `workItems/${id}/comments?api-version=7.1-preview.4`)) : undefined
}

export function issueOf(config: TrackerConfig, response: unknown, comments: unknown): Issue {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  if (config.kind === 'azure-devops') {
    const fields = (value.fields ?? {}) as Record<string, unknown>
    const description = text(fields['System.Description'])
    const relations = Array.isArray(value.relations) ? (value.relations as Record<string, unknown>[]) : []
    const list = typeof comments === 'object' && comments !== null && Array.isArray((comments as { comments?: unknown }).comments) ? ((comments as { comments: Record<string, unknown>[] }).comments) : []
    return {
      summary: text(fields['System.Title']),
      description,
      rules: rulesOf(config, description),
      context: contextOf(config, description),
      comments: list.map(one => unescapeHtml(text(one.text))),
      attachments: relations
        .filter(one => one.rel === 'AttachedFile')
        .map(one => ({ name: text((one.attributes as Record<string, unknown> | undefined)?.name), url: text(one.url) })),
    }
  }
  const description = text(value.description)
  const commentsList = Array.isArray(value.comments) ? (value.comments as Record<string, unknown>[]) : []
  const attachments = Array.isArray(value.attachments) ? (value.attachments as Record<string, unknown>[]) : []
  return {
    summary: text(value.summary),
    description,
    rules: rulesOf(config, description),
    context: contextOf(config, description),
    comments: commentsList.map(one => text(one.text)),
    attachments: attachments.map(one => ({ name: text(one.name), url: text(one.url).startsWith('http') ? text(one.url) : `${config.url}${text(one.url)}` })),
  }
}

export function descriptionRequest(config: TrackerConfig, id: string, description: string): HttpRequest {
  if (config.kind === 'azure-devops') {
    return json(config, 'PATCH', azureApi(config, `workitems/${id}?api-version=7.1`), [{ op: 'add', path: '/fields/System.Description', value: description }], 'application/json-patch+json')
  }
  return json(config, 'POST', `${config.url}/api/issues/${id}?fields=id`, { description })
}

export function commentRequest(config: TrackerConfig, id: string, markdown: string): HttpRequest {
  if (config.kind === 'azure-devops') return json(config, 'POST', azureApi(config, `workItems/${id}/comments?format=markdown&api-version=7.1-preview.4`), { text: markdown })
  return json(config, 'POST', `${config.url}/api/issues/${id}/comments?fields=id`, { text: markdown })
}

export function uploadLines(config: TrackerConfig, id: string, file: string, name: string): string[] {
  if (config.kind === 'azure-devops') {
    return curlLines([
      ['url', azureApi(config, `attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`)],
      ['header', 'Content-Type: application/octet-stream'],
      ['data-binary', `@${file}`],
    ])
  }
  if (/[;,"]/.test(file)) return []
  return curlLines([
    ['url', `${config.url}/api/issues/${encodeURIComponent(id)}/attachments?fields=name,url`],
    ['form', `upload=@${file}`],
  ])
}

export function uploadedUrlOf(config: TrackerConfig, output: string): string {
  try {
    const parsed: unknown = JSON.parse(output)
    if (config.kind === 'azure-devops') return text((parsed as Record<string, unknown>).url)
    const first = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown> | undefined) : undefined
    const url = text(first?.url)
    return url === '' ? '' : `${config.url}${url}`
  } catch {
    return ''
  }
}

export function linkAttachmentRequest(config: TrackerConfig, id: string, url: string, name: string): HttpRequest | undefined {
  if (config.kind !== 'azure-devops') return undefined
  return json(
    config,
    'PATCH',
    azureApi(config, `workitems/${id}?api-version=7.1`),
    [{ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url, attributes: { name } } }],
    'application/json-patch+json',
  )
}

export type FieldKind = 'state' | 'user' | 'period' | 'text'

export type FieldChange = { field: string; kind: FieldKind; value: string | number }

export type Me = { login: string; name: string }

export type Vocabulary = { states: string[]; types: string[]; fields: string[]; links: string[] }

export type JournalEntry = { at: number; ticket: string; title: string; what: string; minutes: number }

const YOUTRACK_FIELD_TYPES: Record<FieldKind, string> = {
  state: 'StateIssueCustomField',
  user: 'SingleUserIssueCustomField',
  period: 'PeriodIssueCustomField',
  text: 'SimpleIssueCustomField',
}

function list(value: unknown, key?: string): Record<string, unknown>[] {
  const source = key === undefined ? value : typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
  return Array.isArray(source) ? source.filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null) : []
}

function patch(config: TrackerConfig, url: string, operations: unknown[]): HttpRequest {
  return json(config, 'PATCH', url, operations, 'application/json-patch+json')
}

export function meRequest(config: TrackerConfig): HttpRequest {
  if (config.kind === 'azure-devops') return json(config, 'GET', `${config.url}/_apis/connectionData`)
  return json(config, 'GET', `${config.url}/api/users/me?fields=login,fullName`)
}

export function meOf(config: TrackerConfig, response: unknown): Me {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  if (config.kind === 'azure-devops') {
    const user = (value.authenticatedUser ?? {}) as Record<string, unknown>
    const account = ((user.properties as Record<string, Record<string, unknown>> | undefined)?.Account?.$value ?? '') as string
    return { login: text(account), name: text(user.providerDisplayName) }
  }
  return { login: text(value.login), name: text(value.fullName) || text(value.login) }
}

function youtrackValue(change: FieldChange): unknown {
  if (change.kind === 'user') return { login: change.value }
  if (change.kind === 'period') return { minutes: Number(change.value) }
  if (change.kind === 'state') return { name: change.value }
  return change.value
}

function azureValue(change: FieldChange): string | number {
  return change.kind === 'period' ? Math.round((Number(change.value) / 60) * 100) / 100 : change.value
}

export function updateRequest(config: TrackerConfig, id: string, changes: FieldChange[]): HttpRequest {
  if (config.kind === 'azure-devops') {
    return patch(config, azureApi(config, `workitems/${id}?api-version=7.1`), changes.map(change => ({ op: 'add', path: `/fields/${change.field}`, value: azureValue(change) })))
  }
  return json(config, 'POST', `${config.url}/api/issues/${id}?fields=id`, {
    customFields: changes.map(change => ({ name: change.field, $type: YOUTRACK_FIELD_TYPES[change.kind], value: youtrackValue(change) })),
  })
}

export function projectOfRequest(config: TrackerConfig, id: string): HttpRequest {
  return json(config, 'GET', `${config.url}/api/issues/${id}?fields=idReadable,summary,project(id),customFields(name,value(name,login))`)
}

export function projectIdOfIssue(response: unknown): string {
  const project = typeof response === 'object' && response !== null ? ((response as Record<string, unknown>).project as Record<string, unknown> | undefined) : undefined
  return text(project?.id)
}

export function typeOfIssue(config: TrackerConfig, response: unknown): string {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  if (config.kind === 'azure-devops') return text(((value.fields ?? {}) as Record<string, unknown>)['System.WorkItemType'])
  const type = list(value, 'customFields').find(one => one.name === 'Type')
  return text((type?.value as Record<string, unknown> | undefined)?.name)
}

export function assigneeOf(config: TrackerConfig, response: unknown, field: string): string {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  if (config.kind === 'azure-devops') {
    const assigned = ((value.fields ?? {}) as Record<string, unknown>)[field]
    return typeof assigned === 'object' && assigned !== null ? text((assigned as Record<string, unknown>).uniqueName) : text(assigned)
  }
  const one = list(value, 'customFields').find(item => item.name === field)
  return text((one?.value as Record<string, unknown> | undefined)?.login)
}

export function titleOfIssue(config: TrackerConfig, response: unknown): string {
  const value = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {}
  return config.kind === 'azure-devops' ? text(((value.fields ?? {}) as Record<string, unknown>)['System.Title']) : text(value.summary)
}

export function subtaskRequest(config: TrackerConfig, projectId: string, parent: string, type: string, title: string, description: string): HttpRequest {
  if (config.kind === 'azure-devops') {
    return patch(config, azureApi(config, `workitems/$${encodeURIComponent(type)}?api-version=7.1`), [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: markdownToHtml(description) },
      { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${config.url}/_apis/wit/workItems/${parent}` } },
    ])
  }
  return json(config, 'POST', `${config.url}/api/issues?fields=idReadable`, { project: { id: projectId }, summary: title, description, customFields: [{ name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: type } }] })
}

export function linkRequest(config: TrackerConfig, child: string, link: string, parent: string): HttpRequest | undefined {
  if (config.kind === 'azure-devops') return undefined
  return json(config, 'POST', `${config.url}/api/commands`, { query: `${link} ${parent}`, issues: [{ idReadable: child }] })
}

export function workItemRequest(config: TrackerConfig, id: string, minutes: number, at: number, note: string): HttpRequest | undefined {
  if (config.kind === 'azure-devops') return undefined
  return json(config, 'POST', `${config.url}/api/issues/${id}/timeTracking/workItems?fields=id`, { duration: { minutes }, date: at, text: note })
}

export function numberField(response: unknown, field: string): number {
  const fields = typeof response === 'object' && response !== null ? (((response as Record<string, unknown>).fields ?? {}) as Record<string, unknown>) : {}
  return Number(fields[field]) || 0
}

export function vocabularyRequests(config: TrackerConfig, projectId: string): HttpRequest[] {
  if (config.kind === 'azure-devops') return [json(config, 'GET', azureApi(config, 'workitemtypes?api-version=7.1'))]
  return [
    json(config, 'GET', `${config.url}/api/admin/projects/${projectId}/customFields?fields=field(name),bundle(values(name))&$top=200`),
    json(config, 'GET', `${config.url}/api/issueLinkTypes?fields=name,sourceToTarget,targetToSource`),
  ]
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function vocabularyOf(config: TrackerConfig, responses: unknown[]): Vocabulary {
  if (config.kind === 'azure-devops') {
    const types = list(responses[0], 'value')
    return {
      types: unique(types.map(one => text(one.name))),
      states: unique(types.flatMap(one => list(one, 'states').map(state => text(state.name)))),
      fields: unique(types.flatMap(one => list(one, 'fields').map(field => text(field.referenceName)))),
      links: ['System.LinkTypes.Hierarchy-Reverse'],
    }
  }
  const fields = list(responses[0])
  const valuesOf = (name: string) => fields.filter(one => text((one.field as Record<string, unknown> | undefined)?.name) === name).flatMap(one => list(one.bundle, 'values').map(value => text(value.name)))
  return {
    types: unique(valuesOf('Type')),
    states: unique(valuesOf('State')),
    fields: unique(fields.map(one => text((one.field as Record<string, unknown> | undefined)?.name))),
    links: unique(list(responses[1]).flatMap(one => [text(one.sourceToTarget), text(one.targetToSource), text(one.name)])),
  }
}

function day(date: string, end: boolean): number {
  return Date.parse(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
}

export function journalRequests(config: TrackerConfig, login: string, from: string, to: string): HttpRequest[] {
  if (config.kind === 'azure-devops') {
    return [json(config, 'POST', azureApi(config, 'wiql?$top=200&api-version=7.1'), { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.ChangedDate] >= '${from}' ORDER BY [System.ChangedDate] DESC` })]
  }
  const author = encodeURIComponent(login)
  return [
    json(config, 'GET', `${config.url}/api/workItems?fields=date,duration(minutes),text,issue(idReadable,summary)&author=${author}&startDate=${from}&endDate=${to}&$top=500`),
    json(config, 'GET', `${config.url}/api/activities?fields=timestamp,target(idReadable,summary),field(name),added(name,login,fullName,minutes),removed(name)&categories=CustomFieldCategory&author=${author}&start=${day(from, false)}&end=${day(to, true)}&$top=500`),
  ]
}

export function journalIdsOf(response: unknown): string[] {
  return list(response, 'workItems').map(one => String(one.id ?? '')).filter(Boolean).slice(0, 100)
}

export function updatesRequest(config: TrackerConfig, id: string): HttpRequest {
  return json(config, 'GET', azureApi(config, `workItems/${id}/updates?api-version=7.1`))
}

function valueName(value: unknown): string {
  if (Array.isArray(value)) return value.map(valueName).filter(Boolean).join(', ')
  if (typeof value === 'object' && value !== null) {
    const one = value as Record<string, unknown>
    return text(one.name) || text(one.fullName) || text(one.displayName) || text(one.login) || (typeof one.minutes === 'number' ? `${one.minutes} min` : '')
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function youtrackJournalOf(responses: unknown[]): JournalEntry[] {
  const work = list(responses[0]).map(one => {
    const issue = (one.issue ?? {}) as Record<string, unknown>
    return { at: Number(one.date) || 0, ticket: text(issue.idReadable), title: text(issue.summary), what: `temps saisi${text(one.text) !== '' ? ` : ${text(one.text)}` : ''}`, minutes: Number((one.duration as Record<string, unknown> | undefined)?.minutes) || 0 }
  })
  const changes = list(responses[1]).map(one => {
    const target = (one.target ?? {}) as Record<string, unknown>
    const field = text((one.field as Record<string, unknown> | undefined)?.name)
    return { at: Number(one.timestamp) || 0, ticket: text(target.idReadable), title: text(target.summary), what: `${field} → ${valueName(one.added)}`, minutes: 0 }
  })
  return [...work, ...changes].sort((a, b) => a.at - b.at)
}

export function azureJournalOf(id: string, response: unknown, login: string, from: string, to: string, spentField: string): JournalEntry[] {
  const start = day(from, false)
  const end = day(to, true)
  return list(response, 'value').flatMap(update => {
    const by = (update.revisedBy ?? {}) as Record<string, unknown>
    const at = Date.parse(text(update.revisedDate))
    const mine = [text(by.uniqueName), text(by.displayName)].some(one => one !== '' && one.toLowerCase() === login.toLowerCase())
    if (!mine || !(at >= start && at <= end)) return []
    const fields = (update.fields ?? {}) as Record<string, { oldValue?: unknown; newValue?: unknown }>
    const title = text(fields['System.Title']?.newValue)
    const entries: JournalEntry[] = []
    const state = fields['System.State']
    if (state !== undefined) entries.push({ at, ticket: id, title, what: `État → ${valueName(state.newValue)}`, minutes: 0 })
    const assigned = fields['System.AssignedTo']
    if (assigned !== undefined) entries.push({ at, ticket: id, title, what: `Assigné → ${valueName(assigned.newValue)}`, minutes: 0 })
    const spent = spentField === '' ? undefined : fields[spentField]
    if (spent !== undefined) entries.push({ at, ticket: id, title, what: 'temps saisi', minutes: Math.round(((Number(spent.newValue) || 0) - (Number(spent.oldValue) || 0)) * 60) })
    return entries
  })
}
