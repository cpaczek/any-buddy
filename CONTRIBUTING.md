# Contributing to any-buddy

Thanks for wanting to contribute! This project is licensed under [WTFPL](LICENSE) -- do what you want.

## Getting Started

```bash
git clone https://github.com/cpaczek/any-buddy.git
cd any-buddy
pnpm install
pnpm run build
```

## Development

The project is written in TypeScript and compiles to ESM JavaScript.

```bash
pnpm run dev          # Run directly via bun (interactive builder, no build step)
pnpm run dev:build    # Build, then run with bun (test compiled output)
pnpm run dev:node     # Build, then run with node (test fallback prompts)
pnpm run build        # Compile TypeScript + resolve path aliases
pnpm run typecheck    # Type-check without emitting
pnpm run test         # Run all tests
pnpm run test:watch   # Run tests in watch mode
pnpm run lint         # ESLint
pnpm run lint:fix     # ESLint with auto-fix
pnpm run format       # Prettier auto-format
pnpm run format:check # Check formatting
```

### Project Structure

```
src/
  cli.ts                  # Entry point (detects Bun, re-execs if needed)
  types.ts                # Shared type definitions
  constants.ts            # Species, rarities, eyes, hats, stats
  personalities.ts        # Default personality strings
  generation/             # Hash + RNG + pet trait generation
  sprites/                # ASCII art rendering
  config/                 # Config file management (pet, claude, hooks)
  patcher/                # Binary finding, salt ops, patching, preflight
  finder/                 # Multi-worker salt brute-force search
  tui/                    # Terminal UI
    display.ts            # Pet rendering + warnings
    format.ts             # Formatting utilities
    prompts.ts            # Fallback sequential prompts (@inquirer/prompts)
    commands/             # Command handlers (interactive, preview, apply, etc.)
    builder/              # Interactive builder TUI (OpenTUI, Bun-only)
      index.ts            # Builder entry + TTY/Bun detection + fallback
      state.ts            # Builder state management + constraints
      selection-panel.ts  # Species/eye/rarity/hat/stats selection UI
      preview-panel.ts    # Live pet preview with stat bars
      keyboard.ts         # Keyboard navigation (Tab, Enter, Esc)
      colors.ts           # Hex color constants for OpenTUI
      stat-bars.ts        # ASCII stat bar visualization
tests/                    # Vitest test files (mirrors src/ structure)
skill/                    # Claude Code skill (standalone, zero-dep)
  SKILL.md                # Skill definition (slash command metadata + workflow)
  sprites.md              # ASCII art for AskUserQuestion previews
  scripts/                # Self-contained Node.js scripts (no npm install)
```

### Path Aliases

Cross-module imports use `@/` aliases instead of relative paths:

```typescript
import { roll } from '@/generation/roll.js';
import { SPECIES } from '@/constants.js';
```

Same-directory imports use relative `.ts` paths (handled by `rewriteRelativeImportExtensions`):

```typescript
export { roll } from './roll.ts';
```

### Pre-commit Hooks

Husky + lint-staged run automatically on commit:
- ESLint with auto-fix
- Prettier formatting

### Running the CLI Locally

```bash
pnpm run dev               # Fastest: runs source directly via bun
pnpm run dev:build         # Tests the compiled output with bun
pnpm run dev:node          # Tests the Node fallback path
```

Or link globally:

```bash
pnpm link --global
any-buddy --help
```

### Runtime Architecture

When invoked via `npx` or `node dist/cli.js`, the CLI detects it's running under Node and automatically re-executes itself under Bun (if available) to enable the interactive builder. This is skipped for `help` and `apply --silent` (hook context). Set `__ANYBUDDY_NO_REEXEC=1` to disable re-execution.

## Testing

Tests use [Vitest](https://vitest.dev/) and are in the `tests/` directory.

```bash
pnpm run test              # Run once
pnpm run test:watch        # Watch mode
pnpm run test:coverage     # With coverage report
```

The test suite covers:
- **generation/** -- Hash determinism, RNG, trait rolling
- **sprites/** -- ASCII rendering, eye substitution, hat placement
- **patcher/** -- Buffer operations, salt detection, runtime detection
- **finder/** -- Probability estimation, worker subprocess integration
- **config/** -- Config round-trips, hook install/remove
- **tui/** -- Formatting, flag validation
- **tui/builder/** -- State management, color validation, stat bars, sprite preview, option generation
- **cli** -- Smoke tests

When testing the builder, use `pnpm run dev` (Bun) for the interactive experience and `pnpm run dev:node` for the fallback path.

## CI/CD

GitHub Actions runs on every push and PR:

- **Quality gate**: lint, format check, type check, build (Ubuntu, Node 22)
- **Test matrix**: 6 jobs (Linux/macOS/Windows x Node 20/22) with Bun installed
- **Release**: Creating a GitHub release auto-publishes to npm

## Submitting Changes

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Ensure `pnpm run build && pnpm run test && pnpm run lint` pass
5. Commit and push
6. Open a PR

No formal style guide beyond what the linter and formatter enforce. Keep it simple.
