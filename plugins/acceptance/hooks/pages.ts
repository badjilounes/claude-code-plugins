export type PageProof = {
  id: string
  kind: string
  media: string
  group: string
  subtitle: string
  scenario: string
  src: string
  text: string
  link: string
}

export type PageScenario = { name: string; steps: string[]; proofs: { id: string; label: string }[] }

export type PageSubject = { name: string; scenarios: PageScenario[] }

export type PageTicket = {
  id: string
  tracker: string
  url: string
  summary: string
  context: string
  branch: string
  branchUrl: string
  status: string
  done: number
  total: number
  proofs: number
}

export type PageLinks = { ticket: string; rules: string; proofs: string }

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif`
const MONO = `ui-monospace, 'SF Mono', Menlo, monospace`

const LIGHT = '--bg:#FAF9F5;--surface:#FFFFFF;--sunk:#F2F0E9;--line:#E5E2D9;--ink:#141413;--muted:#5E5D59;--faint:#7A7974;--accent:#C2603E;--accent-soft:#F6E5DD;--blue:#2E62B0;--blue-soft:#E3ECF8;--green:#2F7D3B;--green-soft:#E3F1E4;--amber:#8F5A07;--amber-soft:#F8ECD5;--violet:#6A47C2;--violet-soft:#ECE6F8;--shadow:0 1px 2px rgba(20,20,19,.06)'
const DARK = '--bg:#1C1B19;--surface:#252421;--sunk:#151413;--line:#363431;--ink:#ECEAE3;--muted:#B5B2A9;--faint:#97948C;--accent:#E08A69;--accent-soft:#3A2A23;--blue:#8DB4EC;--blue-soft:#1F2C3E;--green:#7DC481;--green-soft:#1F3323;--amber:#E3B04B;--amber-soft:#3A2F18;--violet:#B9A2F0;--violet-soft:#2C2540;--shadow:none'

const CSS = `
:root{${LIGHT};color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK};color-scheme:dark}}
:root[data-theme="dark"]{${DARK};color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ${FONT};-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:920px;margin:0 auto;padding:40px 16px 64px;display:flex;flex-direction:column;gap:28px}
header{display:flex;flex-direction:column;gap:10px}
.eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:var(--faint)}
h1{margin:0;font-size:28px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
h2{margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:10px}
h2 .count{font-weight:400;color:var(--faint);font-size:13px}
.lede{margin:0;color:var(--muted);max-width:68ch}
.chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:7px;font-size:12.5px;font-weight:600;white-space:nowrap;background:var(--blue-soft);color:var(--blue)}
.chip svg{width:13px;height:13px;flex-shrink:0}
.chip{max-width:100%;overflow:hidden;text-overflow:ellipsis}.chip .label{overflow:hidden;text-overflow:ellipsis}
.chip.green{background:var(--green-soft);color:var(--green)}.chip.amber{background:var(--amber-soft);color:var(--amber)}.chip.violet{background:var(--violet-soft);color:var(--violet)}.chip.clay{background:var(--accent-soft);color:var(--accent)}
.chip:hover{text-decoration:none;filter:brightness(1.06)}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.progress{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
.bar{flex:1;max-width:240px;height:6px;border-radius:3px;background:var(--sunk);overflow:hidden}.bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
section{display:flex;flex-direction:column;gap:12px}
.scenario{padding:16px 18px;display:grid;grid-template-columns:22px minmax(0,1fr);gap:4px 12px}
.scenario.pending{background:transparent;border-style:dashed}
.check{width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.check.done{background:var(--green);color:var(--surface)}.check.todo{border:1.5px dashed var(--faint)}
.scenario h3{margin:0;font-size:15px;font-weight:600;line-height:1.4}
.steps{grid-column:2;margin:2px 0 0;padding:0;list-style:none;font-size:14px;color:var(--muted)}
.steps b{font-weight:600;color:var(--accent);margin-right:6px}
.links{grid-column:2;margin-top:8px}
.waiting{grid-column:2;margin-top:6px;font-size:13px;color:var(--amber)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.tile{overflow:hidden;display:flex;flex-direction:column}
.tile .shot{position:relative;display:block;aspect-ratio:4/5;background:var(--sunk);overflow:hidden}
.tile .shot img,.tile .shot video{width:100%;height:100%;object-fit:cover;object-position:top;display:block;transition:transform .25s ease}
.tile .shot:hover img,.tile .shot:hover video{transform:scale(1.03)}
.zoom{position:absolute;right:10px;top:10px;width:30px;height:30px;border-radius:15px;background:rgba(20,20,19,.72);color:#fff;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}
.tile .shot:hover .zoom{opacity:1}
.play{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:23px;background:rgba(20,20,19,.7);display:flex;align-items:center;justify-content:center}
.tile .meta{padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.tile .meta .row{flex-wrap:nowrap;min-width:0}
.tile .meta strong{font-size:14px;font-weight:600;line-height:1.35}
.code{overflow:hidden}
.code .head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px}
.code .head .file{font-family:${MONO};font-size:12px;color:var(--faint)}
.code pre{margin:0;padding:14px;background:var(--sunk);font:12.5px/1.6 ${MONO};overflow:auto;max-height:340px;white-space:pre}
.code .foot{padding:10px 14px;border-top:1px solid var(--line)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.fact{padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.fact span{font-size:12px;color:var(--faint)}
.fact strong{font-size:15px;font-weight:600}
.context{padding:18px 20px;white-space:pre-wrap;color:var(--muted);font-size:14.5px}
.lightbox{position:fixed;inset:0;z-index:20;display:none;background:rgba(8,8,8,.86);color:#F2F0EA}
.lightbox:target{display:flex;flex-direction:column}
.lightbox .stage{flex:1;display:flex;align-items:center;justify-content:center;padding:56px 16px 16px;min-height:0}
.lightbox img,.lightbox video{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.lightbox .close{position:absolute;right:20px;top:14px;font-size:22px;color:#F2F0EA;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:18px}
.lightbox .close:hover{background:rgba(255,255,255,.08);text-decoration:none}
.lightbox .bar2{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px 22px;font-size:14px}
.lightbox .nav{display:flex;align-items:center;gap:18px}
.lightbox .nav a{color:#F2F0EA;font-size:22px;width:32px;text-align:center}
.lightbox .nav a:hover{text-decoration:none;opacity:.8}
.empty{color:var(--faint);font-size:14px}
@media (max-width:560px){h1{font-size:23px}main{padding-top:28px}}
`

const ICONS: Record<string, string> = {
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v14"/>',
  rule: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  text: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  artifact: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  external: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}

function chip(label: string, href: string, iconName: string, tone = ''): string {
  return `<a class="chip ${tone}" href="${esc(href)}" title="${esc(label)}">${icon(iconName)}<span class="label">${esc(label)}</span></a>`
}

export function slugId(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`
}

function progress(done: number, total: number): string {
  const ratio = total === 0 ? 0 : Math.round((100 * done) / total)

  return `<div class="progress"><div class="bar"><span style="width:${ratio}%"></span></div>${done} sur ${total} scénario${total > 1 ? 's' : ''} prouvé${done > 1 ? 's' : ''}</div>`
}

function nav(ticket: PageTicket, links: PageLinks, current: string): string {
  const items = [
    current !== 'ticket' && links.ticket !== '' ? chip(`${ticket.id} — Ticket`, links.ticket, 'ticket') : '',
    current !== 'rules' && links.rules !== '' ? chip(`${ticket.id} — Règles`, links.rules, 'rule') : '',
    current !== 'proofs' && links.proofs !== '' ? chip(`${ticket.id} — Preuves`, links.proofs, 'image') : '',
    chip(ticket.tracker, ticket.url, 'external'),
  ]

  return `<div class="row">${items.filter(Boolean).join('')}</div>`
}

const STATUS: Record<string, [string, string]> = {
  open: ['PR ouverte', 'green'],
  draft: ['PR brouillon', ''],
  merged: ['PR fusionnée', 'violet'],
  closed: ['PR fermée', 'clay'],
  dirty: ['Modifications en cours', 'amber'],
  clean: ['À jour', ''],
  none: ['Sans branche', ''],
}

export function ticketPage(ticket: PageTicket, links: PageLinks): string {
  const [statusLabel, statusTone] = STATUS[ticket.status] ?? ['', '']
  const body = `<header><div class="eyebrow">${chip(ticket.id, ticket.url, 'ticket')}<span>Ticket</span></div><h1>${esc(ticket.summary || ticket.id)}</h1>${progress(ticket.done, ticket.total)}${nav(ticket, links, 'ticket')}</header>
<div class="facts"><div class="card fact"><span>Branche</span><strong>${ticket.branchUrl !== '' ? `<a href="${esc(ticket.branchUrl)}">${esc(ticket.branch)}</a>` : esc(ticket.branch)}</strong>${statusLabel !== '' ? `<div>${chip(statusLabel, ticket.branchUrl || ticket.url, 'branch', statusTone)}</div>` : ''}</div><div class="card fact"><span>Règles</span><strong>${ticket.done} / ${ticket.total} prouvées</strong></div><div class="card fact"><span>Preuves</span><strong>${ticket.proofs}</strong></div></div>
${ticket.context.trim() !== '' ? `<section><h2>Contexte</h2><div class="card context">${esc(ticket.context.trim())}</div></section>` : ''}`

  return page(`${ticket.id} — Ticket`, body)
}

export function rulesPage(ticket: PageTicket, feature: string, subjects: PageSubject[], links: PageLinks): string {
  const sections = subjects
    .map(subject => {
      const proven = subject.scenarios.filter(one => one.proofs.length > 0).length
      const cards = subject.scenarios
        .map(scenario => {
          const isDone = scenario.proofs.length > 0
          const steps = scenario.steps
            .map(step => {
              const keyword = step.match(/^\S+/)?.[0] ?? ''
              return `<li><b>${esc(keyword)}</b>${esc(step.slice(keyword.length).trim())}</li>`
            })
            .join('')
          const proofs = scenario.proofs.map(proof => chip(proof.label, `${links.proofs}#proof-${esc(proof.id)}`, 'image', 'green')).join('')
          return `<article class="card scenario${isDone ? '' : ' pending'}" id="rule-${slugId(scenario.name)}"><span class="check ${isDone ? 'done' : 'todo'}">${isDone ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}</span><h3>${esc(scenario.name)}</h3>${steps !== '' ? `<ul class="steps">${steps}</ul>` : ''}${proofs !== '' ? `<div class="row links">${proofs}</div>` : '<div class="waiting">En attente de preuve</div>'}</article>`
        })
        .join('')
      return `<section><h2>${esc(subject.name)}<span class="count">${proven}/${subject.scenarios.length}</span></h2>${cards}</section>`
    })
    .join('')
  const body = `<header><div class="eyebrow">${chip(ticket.id, ticket.url, 'ticket')}<span>Règles d’acceptation</span></div><h1>${esc(feature || 'Règles')}</h1>${progress(ticket.done, ticket.total)}${nav(ticket, links, 'rules')}</header>${sections || '<p class="empty">Aucune règle validée pour ce ticket.</p>'}`

  return page(`${ticket.id} — Règles`, body)
}

function ruleChip(proof: PageProof, links: PageLinks): string {
  return proof.scenario !== '' && links.rules !== '' ? chip(proof.scenario, `${links.rules}#rule-${slugId(proof.scenario)}`, 'rule') : ''
}

export function proofsPage(ticket: PageTicket, proofs: PageProof[], links: PageLinks): string {
  const visuals = proofs.filter(proof => proof.media === 'image' || proof.media === 'video')
  const texts = proofs.filter(proof => proof.media === 'text')
  const artifacts = proofs.filter(proof => proof.kind === 'artifact')
  const groups = new Map<string, PageProof[]>()
  for (const proof of visuals) groups.set(proof.group, [...(groups.get(proof.group) ?? []), proof])
  const viewer = (proof: PageProof, at: number) => {
    const previous = visuals[(at - 1 + visuals.length) % visuals.length]
    const next = visuals[(at + 1) % visuals.length]
    const media = proof.media === 'video' ? `<video src="${esc(proof.src)}" controls playsinline></video>` : `<img src="${esc(proof.src)}" alt="${esc(proof.subtitle)}">`
    return `<div class="lightbox" id="view-${esc(proof.id)}" role="dialog" aria-label="${esc(proof.subtitle)}"><a class="close" href="#proof-${esc(proof.id)}" aria-label="Fermer">✕</a><div class="stage">${media}</div><div class="bar2"><span>${esc(proof.group)} · ${esc(proof.subtitle)}</span><span class="nav"><a href="#view-${esc(previous?.id ?? proof.id)}" aria-label="Précédente">‹</a>${at + 1} sur ${visuals.length}<a href="#view-${esc(next?.id ?? proof.id)}" aria-label="Suivante">›</a></span><span></span></div></div>`
  }
  const tiles = [...groups.entries()]
    .map(([group, items]) => {
      const cards = items
        .map(proof => {
          const media =
            proof.media === 'video'
              ? `<video src="${esc(proof.src)}" muted preload="metadata"></video><span class="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>`
              : `<img src="${esc(proof.src)}" alt="${esc(proof.subtitle)}" loading="lazy">`
          return `<article class="card tile" id="proof-${esc(proof.id)}"><a class="shot" href="#view-${esc(proof.id)}" aria-label="Agrandir ${esc(proof.subtitle)}">${media}<span class="zoom"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/></svg></span></a><div class="meta"><strong>${esc(proof.subtitle)}</strong><div class="row">${ruleChip(proof, links)}</div></div></article>`
        })
        .join('')
      return `<section><h2>${esc(group)}<span class="count">${items.length}</span></h2><div class="grid">${cards}</div></section>`
    })
    .join('')
  const codes = texts.length === 0 ? '' : `<section><h2>Requêtes et tests<span class="count">${texts.length}</span></h2>${texts.map(proof => `<article class="card code" id="proof-${esc(proof.id)}"><div class="head">${chip(proof.kind === 'curl' ? 'cURL' : proof.kind, `#proof-${esc(proof.id)}`, 'text', proof.kind === 'test' ? 'green' : 'clay')}<strong>${esc(proof.subtitle)}</strong><span class="file">${esc(proof.src)}</span></div><pre>${esc(proof.text)}</pre>${ruleChip(proof, links) !== '' ? `<div class="foot row">${ruleChip(proof, links)}</div>` : ''}</article>`).join('')}</section>`
  const others = artifacts.length === 0 ? '' : `<section><h2>Artefacts<span class="count">${artifacts.length}</span></h2>${artifacts.map(proof => `<div class="row" id="proof-${esc(proof.id)}">${chip(proof.subtitle, proof.link, 'artifact')}${ruleChip(proof, links)}</div>`).join('')}</section>`
  const body = `<header><div class="eyebrow">${chip(ticket.id, ticket.url, 'ticket')}<span>Preuves</span></div><h1>${esc(ticket.summary || ticket.id)}</h1><p class="lede">${proofs.length} preuve${proofs.length > 1 ? 's' : ''} · ${ticket.done} sur ${ticket.total} scénarios prouvés</p>${nav(ticket, links, 'proofs')}</header>${tiles}${codes}${others}${proofs.length === 0 ? '<p class="empty">Aucune preuve pour ce ticket.</p>' : ''}${visuals.map(viewer).join('')}`

  return page(`${ticket.id} — Preuves`, body)
}
