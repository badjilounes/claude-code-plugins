import { describe, expect, test } from 'claude-code/testing'

import { proofsPage, rulesPage, ticketPage } from '../hooks/pages'

const TICKET = { id: 'CORE-25', url: 'https://acme.youtrack.cloud/issue/CORE-25', summary: 'Calendrier', context: 'Pourquoi', branch: 'feature/CORE-25', branchUrl: 'https://gh/tree', status: 'dirty', done: 1, total: 2, proofs: 2 }
const LINKS = { ticket: 'https://claude.ai/artifact/T', rules: 'https://claude.ai/artifact/R', proofs: 'https://claude.ai/artifact/P' }

describe('ticket artifacts', () => {
  test('each artifact is titled after its ticket and links to the two others', async () => {
    const ticket = ticketPage(TICKET, LINKS)
    const rules = rulesPage(TICKET, 'Feature', [{ name: 'Vide', scenarios: [{ name: 'Aucune publication', steps: ['Given rien'], proofs: [{ id: '7', label: 'mobile' }] }] }], LINKS)

    expect(ticket).toContain('<title>CORE-25 — Ticket</title>')
    expect(ticket).toContain('href="https://claude.ai/artifact/R"')
    expect(rules).toContain('<title>CORE-25 — Règles</title>')
    expect(rules).toContain('href="https://claude.ai/artifact/P#proof-7"')
    expect(rules).toContain('id="rule-aucune-publication"')
  })

  test('proofs open in a full-screen viewer inside the artifact and point back to their rule', async () => {
    const page = proofsPage(TICKET, [
      { id: '7', kind: 'capture', media: 'image', group: 'Web — mobile', subtitle: 'mobile', scenario: 'Aucune publication', src: 'media/a.png', text: '', link: '' },
      { id: '8', kind: 'curl', media: 'text', group: 'API', subtitle: 'GET /', scenario: '', src: 'b.txt', text: '200 <OK>', link: '' },
    ], LINKS)

    expect(page).toContain('<title>CORE-25 — Preuves</title>')
    expect(page).toContain('href="#view-7"')
    expect(page).toContain('id="view-7"')
    expect(page).toContain('href="https://claude.ai/artifact/R#rule-aucune-publication"')
    expect(page).toContain('200 &lt;OK&gt;')
  })
})
