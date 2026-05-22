import { runTool } from '../src/utils/run-tool.ts'

runTool({
  args: ['--config', 'knip.json'],
  cmd: 'knip',
  label: 'deadcode:check',
})
