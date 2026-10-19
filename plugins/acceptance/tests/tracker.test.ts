import { describe, expect, test } from 'claude-code/testing'

import { configOf, contextOf, curlLines, isProofId, isTrackerUrl, safeFileName, uploadLines, displayId, issueUrl, proofMarker, proofOf, rulesOf, ticketOf, withRules } from '../hooks/tracker'

const YOUTRACK = configOf({ tracker: 'youtrack', trackerUrl: 'https://acme.youtrack.cloud', projects: 'CORE' }, 'env-token')
const AZURE = configOf({ tracker: 'azure-devops', trackerUrl: 'https://dev.azure.com/acme', azureProject: 'Shop', token: 'pat' }, '')

describe('tracker adapter', () => {
  test('reads the ticket id off the branch name the way each tracker numbers them', async () => {
    expect(ticketOf(YOUTRACK, 'feature/CORE-12-login')).toBe('CORE-12')
    expect(ticketOf(YOUTRACK, 'feature/login')).toBe('')
    expect(ticketOf(AZURE, 'fix/987')).toBe('987')
    expect(ticketOf(AZURE, 'feature/987-login')).toBe('987')
    expect(ticketOf(AZURE, 'feature/v2-login')).toBe('')
    expect(ticketOf(AZURE, 'release-2026')).toBe('')
  })

  test('falls back on the environment token and labels Azure items with #', async () => {
    expect(YOUTRACK.token).toBe('env-token')
    expect(displayId(AZURE, '987')).toBe('#987')
    expect(issueUrl(AZURE, '987')).toBe('https://dev.azure.com/acme/Shop/_workitems/edit/987')
    expect(issueUrl(configOf({}, ''), 'CORE-1')).toBe('')
  })

  test('a proof marker survives an HTML rendering of the comment', async () => {
    const marker = proofMarker({ id: '1', title: 'Santé — « ok »' })
    const html = `<p><strong>Preuve</strong></p><p><code>${marker.replace(/`/g, '')}</code></p>`

    expect(proofOf(html)).toEqual({ id: '1', title: 'Santé — « ok »' })
    expect(proofOf('rien')).toBeUndefined()
  })

  test('rules round-trip through each description format', async () => {
    const feature = 'Feature: F\n  Scenario: a < b'

    expect(rulesOf(YOUTRACK, withRules(YOUTRACK, 'Contexte', feature))).toBe(feature)
    expect(rulesOf(AZURE, withRules(AZURE, '<p>Contexte</p>', feature))).toBe(feature)
    expect(contextOf(AZURE, withRules(AZURE, '<p>Contexte</p>', feature))).toBe('Contexte')
  })

  test('names and urls read from a ticket are trusted only when harmless', async () => {
    expect(safeFileName('1700-api-sante.txt')).toBe('1700-api-sante.txt')
    expect(safeFileName('../../.zshrc')).toBe('')
    expect(safeFileName('.env')).toBe('')
    expect(safeFileName('a"\noutput = "/etc/x')).toBe('')
    expect(isProofId('1700000000000')).toBe(true)
    expect(isProofId('"><img>')).toBe(false)
    expect(isTrackerUrl(YOUTRACK, 'https://acme.youtrack.cloud/api/files/1?sign=x')).toBe(true)
    expect(isTrackerUrl(YOUTRACK, 'https://evil.example/steal')).toBe(false)
    expect(isTrackerUrl(YOUTRACK, 'http://acme.youtrack.cloud/api/files/1')).toBe(false)
  })

  test('a curl config value can neither close its quotes nor add a line', async () => {
    expect(curlLines([['output', '/repo/a "b" \\c']])).toEqual(['output = "/repo/a \\"b\\" \\\\c"'])
    expect(curlLines([['url', 'https://x/\nupload-file = "/etc/passwd"']])).toEqual([])
    expect(uploadLines(YOUTRACK, 'CORE-1', '/repo/a;type=text/html', 'a')).toEqual([])
  })
})

