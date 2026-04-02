---
name: customize-claude-buddy
description: Use when the user wants to change their Claude Code companion pet, customize their buddy, pick a different species/rarity/hat/eyes, or troubleshoot companion pet issues
---

# Customize Claude Code Companion Pet

Change the user's Claude Code companion pet by finding a salt that produces desired traits and patching the binary. Self-contained — runs on Node.js only, no external dependencies.

## Prerequisites

- **Node.js** (ships with Claude Code)
- **Claude Code** binary must exist (compiled binary or Node-based `.js` install)

## Scripts (in this skill's directory)

All scripts are at `~/.claude/skills/customize-claude-buddy/scripts/`.

| Script | Purpose |
|--------|---------|
| `get-user-info.mjs` | Read userId, companion info, saved config |
| `find-salt.mjs` | Brute-force search for salt matching desired traits |
| `patch-binary.mjs` | Patch binary, restore, or check status |
| `wyhash.mjs` | Vendored wyhash WASM module (used by find-salt) |
| `shared.mjs` | Shared constants and functions (species, eyes, hats, hash, RNG) |
| `companion.mjs` | Rename companion, change personality, list presets, delete companion |
| `show-pet.mjs` | Show current pet traits (default and patched) without modifying anything |

All scripts run on **Node.js**. No Bun, no npm install.

**Hash function note:** Claude Code uses **wyhash** when running under Bun (compiled binary) or **FNV-1a** when running under Node (e.g., Windows npm installs). The scripts auto-detect this via `--check` output and accept a `--fnv1a` flag when needed.

## Workflow: Change Pet

Follow these steps in order:

### Step 1: Get user info and detect runtime
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/get-user-info.mjs
```
Extract `userId` from the JSON output.

Then check the binary status:
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --check
```
Check the `nodeRuntime` field in the JSON output. If `true`, you must pass `--fnv1a` to `find-salt.mjs` and `show-pet.mjs` in later steps (the binary runs under Node and uses FNV-1a hash instead of wyhash).

### Step 2: Ask user what they want

Use AskUserQuestion with `preview` fields to show ASCII art. See `sprites.md` in this skill's directory for all sprites.

**2a. Species category** — ask with 4 options, each previewing the species in that group:

| Option | Species | Preview content |
|--------|---------|-----------------|
| Birds | duck, goose, owl, penguin | ASCII art of all 4 from sprites.md "Birds" section |
| Cute Creatures | cat, rabbit, capybara, chonk | ASCII art from "Cute Creatures" section |
| Aquatic & Nature | octopus, turtle, snail, axolotl | ASCII art from "Aquatic & Nature" section |
| Fantasy & Unique | dragon, ghost, blob, mushroom, cactus, robot | ASCII art from "Fantasy & Unique" section |

**2b. Species** — ask with the species from the chosen category (2-4 options), each previewing that species' ASCII art. If the category has more than 4 (Fantasy & Unique has 6), split across two questions or let user type via "Other".

**2c. Rarity** — ask with 4 options + previews:

| Option | Preview |
|--------|---------|
| Common | `★☆☆☆☆  60% chance — no hat` |
| Uncommon | `★★☆☆☆  25% chance — unlocks hats` |
| Rare | `★★★☆☆  10% chance — ~10s search` |
| Epic | `★★★★☆   4% chance — ~30s search` |

Legendary (1%) is available via "Other". Warn it may take minutes.

**2d. Eyes** — ask with 4 options + previews showing the eye character large, remaining 2 via "Other":

| Option | Preview |
|--------|---------|
| `·` dot | `( ·  · )  — classic, clean` |
| `✦` sparkle | `( ✦  ✦ )  — magical, shiny` |
| `×` cross | `( ×  × )  — sleepy, dizzy` |
| `◉` target | `( ◉  ◉ )  — intense, focused` |

`@` and `°` available via "Other".

**2e. Hat** (skip if common rarity — always `none`):
Ask with 4 options + ASCII hat preview, remaining via "Other":

| Option | Preview |
|--------|---------|
| none | `(no hat)` |
| crown | `   \^^^/\n  ( ·  · )` |
| tophat | `   [___]\n  ( ·  · )` |
| wizard | `    /^\n  ( ·  · )` |

propeller, halo, beanie, tinyduck available via "Other".

### Step 3: Find a matching salt
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/find-salt.mjs <userId> <species> <rarity> <eye> <hat>
```
- Outputs JSON with `salt`, `attempts`, `totalAttempts`, `elapsed`, `workers` on success
- **Multi-worker**: Automatically uses all CPU cores (up to 8) for parallel search
- **Early-exit**: Checks each trait immediately, skipping unnecessary RNG calls on mismatch
- Progress updates on stderr every 100K attempts per worker
- Common combos: ~8K attempts (~1-2s). Legendary: ~800K attempts (~minutes, much faster with multi-core)
- Optional args: `[shiny] [peak] [dump]` — shiny=true/false, peak/dump=STAT_NAME or "any"
- **If `nodeRuntime` was `true` in Step 1**, append `--fnv1a`:
  ```bash
  node ~/.claude/skills/customize-claude-buddy/scripts/find-salt.mjs <userId> <species> <rarity> <eye> <hat> --fnv1a
  ```

**Run this in background** if the combination is rare (epic/legendary). Use `timeout 300` to cap at 5 minutes.

### Step 4: Patch the binary
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs <salt>
```
- Finds Claude binary automatically
- Creates backup at `<binary>.anybuddy-bak`
- Atomic write + macOS code signing
- Outputs JSON with success status

### Step 5: Confirm patch
Tell the user the patch was applied and the SessionStart hook is installed for auto-re-patching after updates.

If the patch output includes `claudeRunning: true`, warn the user that Claude Code is currently running and they need to **quit and relaunch** to see the new pet (the patch is safe — atomic rename keeps the running process on the old binary).

### Step 6: Optional — Rename companion

Check if companion exists using the info from Step 1 (companion field in get-user-info output).

**If no companion exists** (companion is null): skip Steps 6-7, tell user to run `/buddy` in Claude Code first to hatch a companion, then run this skill again for rename/personality.

**If companion exists**, ask via `AskUserQuestion`:
- "Keep current name" (Recommended) — show current name in description
- "Rename" — let user type new name via "Other"

If renaming:
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/companion.mjs --rename "NewName"
```

### Step 7: Optional — Customize personality

Show the current personality from Step 1 output. Get the species-specific default preset:
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/companion.mjs --preset <species>
```

Ask via `AskUserQuestion`:
- "Keep current personality" (Recommended) — show current personality in description
- "Use species default" — show the preset text in description (e.g., for dragon: "A fierce guardian of clean code...")
- "Write custom" — let user describe personality via "Other"

Apply the chosen personality:
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/companion.mjs --personality "chosen personality text"
```

### Step 8: Final confirmation
Tell the user:
- Patch was applied (restart Claude Code to see new pet)
- Name change (if any)
- Personality change (if any)

**Note:** The patch command automatically installs a `SessionStart` hook in `~/.claude/settings.json`. This hook runs `patch-binary.mjs --apply` on every Claude Code launch, which silently re-patches the binary if a Claude update reverted it to the original salt. No manual re-patching needed.

## Other Operations

**Show current pet traits (default and patched):**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/show-pet.mjs
```
Outputs JSON with `defaultPet` (what the original salt produces) and `patchedPet` (what the current patched salt produces, if any). Each pet includes species, rarity, stars, eye, hat, shiny, peak stat, dump stat. Use this when the user asks "what's my current pet?" or wants to see before changing.

For Node-based Claude installs (Windows npm), pass `--fnv1a`:
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/show-pet.mjs --fnv1a
```

**Delete companion (re-hatch via /buddy):**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/companion.mjs --delete
```
Removes the companion from `~/.claude.json`. Next time the user runs `/buddy` in Claude Code, a fresh companion will be hatched with the patched species but a new AI-generated name and personality. **Always confirm with user before deleting** — this is irreversible.

**Check current status (includes hook status and whether Claude is running):**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --check
```

**Restore original pet (also removes the hook):**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --restore
```

**Manually re-apply saved salt after Claude update:**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --apply
```
This is what the SessionStart hook runs automatically. It reads the saved salt from `~/.claude-code-any-buddy.json` and re-patches if the binary reverted.

**Hook management:**
```bash
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --install-hook
node ~/.claude/skills/customize-claude-buddy/scripts/patch-binary.mjs --remove-hook
```
The hook is auto-installed on first patch and auto-removed on restore. These commands are for manual control.

## Troubleshooting

- **Binary not found**: Set `CLAUDE_BINARY=/path/to/binary` env var. Auto-detection covers Volta, nvm, npm-global, Windows .cmd shims, and direct `.js` installs
- **Binary too small (<1MB)**: It's a shim. The script auto-resolves through Volta/nvm shims, npm .cmd wrappers, and Node .js files, but if it still fails, set `CLAUDE_BINARY` manually
- **Salt not found in binary**: Binary may have been updated. Try `--restore` first, then re-patch. Note: Windows binaries have fewer salt occurrences (1 vs 3 on macOS/Linux) — this is expected
- **Wrong pet after patching**: If the binary is a `.js` file (Node runtime), you must use `--fnv1a` with `find-salt.mjs` and `show-pet.mjs`. Check `nodeRuntime` in `--check` output
- **macOS signing fails**: Run `codesign --force --sign - <binaryPath>` manually

## Stats (optional advanced)

**Stat names:** DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK

To target specific peak/dump stats, add them to the find-salt call:
```bash
node find-salt.mjs <userId> dragon epic · crown false WISDOM CHAOS
```
This multiplies search time by ~20x (mitigated by multi-worker parallelism).

## Personality Presets

Default personality descriptions per species. Use these in the `AskUserQuestion` description field when offering the "Use species default" option.

| Species | Default Personality |
|---------|-------------------|
| duck | A cheerful quacker who celebrates your wins with enthusiastic honks and judges your variable names with quiet side-eye. |
| goose | An agent of chaos who thrives on your merge conflicts and honks menacingly whenever you write a TODO comment. |
| blob | A formless, chill companion who absorbs your stress and responds to everything with gentle, unhurried wisdom. |
| cat | An aloof code reviewer who pretends not to care about your bugs but quietly bats at syntax errors when you're not looking. |
| dragon | A fierce guardian of clean code who breathes fire at spaghetti logic and hoards well-written functions. |
| octopus | A multitasking genius who juggles eight concerns at once and offers tentacle-loads of unsolicited architectural advice. |
| owl | A nocturnal sage who comes alive during late-night debugging sessions and asks annoyingly insightful questions. |
| penguin | A tuxedo-wearing professional who waddles through your codebase with dignified concern and dry wit. |
| turtle | A patient mentor who reminds you that slow, steady refactoring beats heroic rewrites every time. |
| snail | A zen minimalist who moves at their own pace and leaves a trail of thoughtful, unhurried observations. |
| ghost | A spectral presence who haunts your dead code and whispers about the bugs you thought you fixed. |
| axolotl | A regenerative optimist who believes every broken build can be healed and every test can be unflaked. |
| capybara | The most relaxed companion possible — nothing fazes them, not even production outages at 3am. |
| cactus | A prickly but lovable desert dweller who thrives on neglect and offers sharp, pointed feedback. |
| robot | A logical companion who speaks in precise technical observations and occasionally glitches endearingly. |
| rabbit | A fast-moving, hyperactive buddy who speed-reads your diffs and bounces between topics at alarming pace. |
| mushroom | A wry fungal sage who speaks in meandering tangents about your bugs while secretly enjoying the chaos. |
| chonk | An absolute unit of a companion who sits on your terminal with maximum gravitational presence and minimal urgency. |
