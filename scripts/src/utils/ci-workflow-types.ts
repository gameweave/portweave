export interface Step {
  [key: string]: unknown
  name?: string
  run?: string
  uses?: string
}

interface Job {
  [key: string]: unknown
  steps?: Step[]
}

export interface Workflow {
  [key: string]: unknown
  jobs: Record<string, Job>
}
