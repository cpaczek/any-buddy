export { findClaudeBinary, findBunBinary, resolveShellWrapper } from './binary-finder.ts';
export {
  findAllOccurrences,
  getCurrentSalt,
  verifySalt,
  isClaudeRunning,
  isNodeRuntime,
  getMinSaltCount,
} from './salt-ops.ts';
export { patchBinary, restoreBinary } from './patch.ts';
export { runPreflight } from './preflight.ts';
