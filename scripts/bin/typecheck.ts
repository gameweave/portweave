import { runTool } from '../src/utils/run-tool.ts'

// Run two typecheck passes: the main project (src + tests) and the config/scripts project.
// Each pass runs `tsc --noEmit` against its own tsconfig so config files can use TS extensions
// without polluting the build of the actual library code.
runTool({
  args: ['--noEmit', '-p', 'tsconfig.json'],
  cmd: 'tsc',
  label: 'typecheck:src',
})
runTool({
  args: ['--noEmit', '-p', 'tsconfig.config.json'],
  cmd: 'tsc',
  label: 'typecheck:config',
})
