import { describe, expect, test } from 'claude-code/testing'

import { configOf, contextOf, displayId, issueUrl, proofMarker, proofOf, rulesOf, ticketOf, withRules } from '../hooks/tracker'

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
})
