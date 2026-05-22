import { runTool } from '../src/utils/run-tool.ts'

runTool({
  args: ['.', '--config', '.jscpd.json'],
  cmd: 'jscpd',
  label: 'dupcheck',
})
