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
