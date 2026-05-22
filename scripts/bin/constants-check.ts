import { runTool } from '../src/utils/run-tool.ts'

const check = process.argv.includes('--check')
// Scope analysis to code we own. Excludes:
//   - reference/ (read-only boardflip snapshot)
//   - eslint config (rule strings are intentionally repeated)
//   - scripts/src/tasks/ (drop-in from boardflip)
const args = ['--paths', 'src,scripts/bin']
if (check) {
  args.push('--check')
}
runTool({ args, cmd: 'constants-check', label: 'constants:check' })
