export type EvidenceKind = 'capture' | 'video' | 'curl' | 'test' | 'artifact' | 'file' | 'other'

export type EvidenceMedia = 'image' | 'video' | 'text' | 'pdf' | ''

export type Evidence = {
  id: string
  kind: EvidenceKind
  title: string
  subtitle: string
  scenario: string
  detail: string
  file: string
  media: EvidenceMedia
  thumb: string
  poster: string
  large: string
  width: number
  height: number
  remote: string
  page: string
  isSynced: boolean
  at: number
}

export type BranchStatus = 'none' | 'clean' | 'dirty' | 'open' | 'draft' | 'merged' | 'closed'

export type BranchInfo = { name: string; status: BranchStatus; url: string; pr: number }

export type Ticket = { id: string; url: string; summary: string; context: string }

export type Pages = { ticket: string; rules: string; proofs: string }

declare module 'claude-code' {
  interface PluginState {
    acceptance: { evidence: Evidence[]; branch: BranchInfo; criteria: string; ticket: Ticket; collapsed: string[]; pages: Pages }
  }
}
