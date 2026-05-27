import { runTool } from '../src/utils/run-tool.ts'

const checkOnly = process.argv.includes('--check')
const args = checkOnly ? ['--check', '.'] : ['--write', '.']
runTool({ args, cmd: 'prettier', label: 'format' })
