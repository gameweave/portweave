import { runTool } from '../src/utils/run-tool.ts'

const fix = process.argv.includes('--fix')
const args = fix ? ['.', '--fix'] : ['.']
runTool({ args, cmd: 'eslint', label: 'lint' })
