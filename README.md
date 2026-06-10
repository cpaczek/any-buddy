# Buddy feature was removed from claude code in .97 was a blast building this and thank you to all the contributors and if they every bring it back we will hack it again

<p align="center">
  <img src="assets/header.svg" alt="any-buddy" width="700">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/any-buddy"><img src="https://img.shields.io/npm/v/any-buddy?color=cb3837&label=npm" alt="npm"></a>
  <a href="https://github.com/cpaczek/any-buddy/actions"><img src="https://img.shields.io/github/actions/workflow/status/cpaczek/any-buddy/ci.yml?label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-WTFPL-brightgreen" alt="License: WTFPL"></a>
  <img src="https://img.shields.io/node/v/any-buddy" alt="Node version">
</p>

<p align="center">
  Pick any Claude Code companion pet you want. Choose your species, rarity, eyes, hat, and name.
</p>

---

## Quick Start

```bash
npx any-buddy@latest
```

That's it. If Bun is installed, you get the full interactive builder with live preview. Otherwise you'll see sequential prompts with a note to install Bun.

<p align="center">
  <img src="assets/builder.png" alt="Interactive Builder" width="700">
</p>

The builder lets you browse species, eyes, rarity, hats, and stats with a live ASCII art preview that updates as you scroll. Navigate with arrow keys, Tab/Enter to advance, Esc to cancel.

## Install

```bash
# npm (global)
npm install -g any-buddy

# or clone
git clone https://github.com/cpaczek/any-buddy.git
cd any-buddy && pnpm install && pnpm link --global
```

### Requirements

- **Node.js >= 20**
- **Bun** -- for the interactive builder TUI and correct hash computation (typically already installed with Claude Code). Without Bun, the tool falls back to basic sequential prompts.
- **Claude Code** -- installed via any standard method

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Tested | Auto-detects `~/.local/share/claude/versions/` |
| macOS | Tested | Auto-detects + ad-hoc re-signs after patching |
| Windows | Tested | Works with npm-based installs (`cli.js`) |

> Set `CLAUDE_BINARY=/path/to/binary` if auto-detection fails.

## Usage

```bash
any-buddy                    # Start screen — build, browse presets, or switch buddies
```

The start screen lets you pick between:
- **Build your own** — full interactive builder with live ASCII preview
- **Browse presets** — 23 curated themed builds with animated preview
- **Saved buddies** — switch between your saved pets (shown when you have saves)

After picking your pet, the entire flow stays in the TUI — salt search with progress bar, naming, personality, patching, and hook setup.

```bash
any-buddy current            # Show your current pet
any-buddy preview            # Browse without applying
any-buddy apply              # Re-apply after Claude Code update
any-buddy restore            # Restore original pet
any-buddy buddies            # Browse and switch between your buddies
any-buddy rehatch            # Delete companion, re-hatch via /hatch
```

### Non-Interactive Mode

Skip prompts with flags (bypasses the start screen):

```bash
any-buddy -s dragon -r legendary -e '✦' -t wizard --shiny --name Draco -y
any-buddy --preset "Arcane Dragon" -y
```

<details>
<summary><strong>All CLI Flags</strong></summary>

| Flag | Short | Description |
|------|-------|-------------|
| `--species <name>` | `-s` | Species (duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk) |
| `--rarity <level>` | `-r` | Rarity (common, uncommon, rare, epic, legendary) |
| `--eye <char>` | `-e` | Eye style (` ·  ✦  ×  ◉  @  ° `) |
| `--hat <name>` | `-t` | Hat (crown, tophat, propeller, halo, wizard, beanie, tinyduck) |
| `--preset <name>` | | Use a curated preset (e.g., "Arcane Dragon") |
| `--name <name>` | `-n` | Rename companion |
| `--personality <desc>` | `-p` | Set personality (controls speech bubble) |
| `--shiny` | | Require shiny (~100x longer search) |
| `--peak <stat>` | | Best stat (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK) |
| `--dump <stat>` | | Worst stat |
| `--yes` | `-y` | Skip confirmations |
| `--no-hook` | | Don't offer auto-patch hook |
| `--silent` | | Suppress output (for hooks) |

</details>

## All 18 Species

<p align="center">
  <img src="assets/species.svg" alt="All 18 species" width="700">
</p>

## Customization Options

<p align="center">
  <img src="assets/options.svg" alt="Customization options" width="700">
</p>

## Restoring

```bash
any-buddy restore
```

Patches the salt back to original and removes the auto-patch hook. Your saved buddies are preserved — use `any-buddy buddies` to reactivate one later.

## How It Works

See [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for the full technical deep-dive on hashing, binary patching, the salt search algorithm, and the auto-patch hook.

## Known Limitations

- **macOS**: Binary is ad-hoc re-signed after patching. If Claude Code won't launch, run `any-buddy restore`
- **Bun recommended**: Required for the interactive builder and correct wyhash computation. Without Bun, falls back to sequential prompts with FNV-1a (Node-based installs)
- **Salt dependent**: If Anthropic changes the salt string, the tool will detect this and warn you
- **Stats**: You pick peak/dump stats, but exact values are seed-determined

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and how to submit changes.

## Credits

- [@jtuskan](https://github.com/jtuskan) -- Windows support for npm-based installs ([#5](https://github.com/cpaczek/any-buddy/pull/5))
- [@aaronepinto](https://github.com/aaronepinto) -- macOS ad-hoc code signing ([#3](https://github.com/cpaczek/any-buddy/pull/3))
- [@joshpocock](https://github.com/joshpocock) -- FNV-1a hash support for Node runtime ([#8](https://github.com/cpaczek/any-buddy/pull/8))
- [@Co-Messi](https://github.com/Co-Messi) -- Multi-worker parallelism + early-exit optimization ([#11](https://github.com/cpaczek/any-buddy/pull/11)), curated preset builds ([#15](https://github.com/cpaczek/any-buddy/pull/15))
- [@Ahmad8864](https://github.com/Ahmad8864) -- 8-core cap idea ([#10](https://github.com/cpaczek/any-buddy/pull/10)), buddy profiles ([#17](https://github.com/cpaczek/any-buddy/pull/17))

## License

[WTFPL](LICENSE) -- Do What The Fuck You Want To Public License.
