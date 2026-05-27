import { runTool } from '../src/utils/run-tool.ts'

const check = process.argv.includes('--check')
// Scope analysis to code we own. Excludes:
//   - eslint config (rule strings are intentionally repeated)
//   - scripts/src/tasks/ (session-based task management, vendored tooling)
const args = ['--paths', 'src,scripts/bin']
if (check) {
  args.push('--check')
}
runTool({ args, cmd: 'constants-check', label: 'constants:check' })
