import type { CliFlags, DesiredTraits, Bones, FinderResult } from '@/types.js';
import { ORIGINAL_SALT, RARITY_STARS } from '@/constants.js';
import { ISSUE_URL } from '@/constants.js';
import { roll } from '@/generation/index.js';
import { findSalt, estimateAttempts } from '@/finder/index.js';
import {
  isClaudeRunning,
  verifySalt,
  getCurrentSalt,
  getMinSaltCount,
} from '@/patcher/salt-ops.js';
import { patchBinary } from '@/patcher/patch.js';
import {
  loadPetConfig,
  loadPetConfigV2,
  savePetConfigV2,
  saveProfile,
  isHookInstalled,
  installHook,
  getCompanionName,
  renameCompanion,
  getCompanionPersonality,
  setCompanionPersonality,
} from '@/config/index.js';
import { DEFAULT_PERSONALITIES } from '@/personalities.js';
import { renderAnimatedSprite, IDLE_SEQUENCE } from '@/sprites/index.js';
import { createAnimator } from '@/tui/animator.js';
import { BORDER_COLOR, DIM_COLOR, FOCUS_BORDER, RARITY_HEX } from '@/tui/builder/colors.js';
import { formatCount } from '@/tui/format.js';

interface SetupInfo {
  userId: string;
  binaryPath: string;
  useNodeHash: boolean;
}

// Step order: confirm → search → name → personality → patch → hook → done
type Step =
  | 'confirm_search'
  | 'searching'
  | 'name'
  | 'personality'
  | 'personality_custom'
  | 'confirm_patch'
  | 'confirm_hook'
  | 'done';

export async function runApplyTUI(
  desired: DesiredTraits,
  flags: CliFlags,
  setup: SetupInfo,
): Promise<void> {
  const otui = await import('@opentui/core');
  const { createCliRenderer, Box, Text, Input, Select, InputRenderableEvents, StyledText } = otui;
  const { dim: dimStyle, link: linkStyle, fg: fgStyle, underline: underlineStyle } = otui;
  type TextRenderableType = InstanceType<typeof otui.TextRenderable>;
  type InputRenderableType = InstanceType<typeof otui.InputRenderable>;
  type SelectRenderableType = InstanceType<typeof otui.SelectRenderable>;
  type BoxRenderableType = InstanceType<typeof otui.BoxRenderable>;

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

  try {
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      screenMode: 'alternate-screen',
    });

    const r = renderer;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const animator = createAnimator(500);
      let unsubAnimation: (() => void) | null = null;
      let currentStep: Step = flags.yes ? 'searching' : 'confirm_search';

      // State accumulated across steps
      let saltResult: FinderResult | null = null;
      let foundBones: Bones | null = null;
      let profileName = '';
      let lastRenderedFrame = -1;
      const previewBones: Bones = { ...desired, stats: {} };
      const color = RARITY_HEX[desired.rarity];

      // Widget tracking for cleanup
      let stepWidgetIds: string[] = [];
      let widgetCounter = 0;
      let activeInput: InputRenderableType | null = null;
      let activeSelect: SelectRenderableType | null = null;

      // Search progress text refs
      let searchBarText: TextRenderableType | null = null;
      let searchDetailText: TextRenderableType | null = null;

      const handleCtrlC = (key: { ctrl?: boolean; name?: string }) => {
        if (key.ctrl && key.name === 'c') finish();
      };

      function finish(): void {
        if (resolved) return;
        resolved = true;
        unsubAnimation?.();
        animator.stop();
        r.keyInput.removeListener('keypress', handleCtrlC);
        r.keyInput.removeListener('keypress', handleKeys);
        r.destroy();
        renderer = null;
        resolve();
      }

      // --- Layout ---
      const rootBox = Box(
        {
          id: 'root',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          borderStyle: 'rounded',
          border: true,
          borderColor: BORDER_COLOR,
          title: ' any-buddy ',
          titleAlignment: 'center',
          padding: 0,
          paddingLeft: 2,
          paddingRight: 2,
        },
        Text({ id: 'pet-title', content: '', height: 1, paddingTop: 1 }),
        Text({ content: '', height: 1 }),
        Text({ id: 'pet-sprite', content: '', height: 5 }),
        Text({ content: '', height: 1 }),
        Text({ id: 'separator', content: '─'.repeat(50), fg: DIM_COLOR, height: 1 }),
        Text({ content: '', height: 1 }),
        Box({
          id: 'step-area',
          flexDirection: 'column',
          flexGrow: 1,
          width: '100%',
        }),
        Text({
          id: 'help-bar',
          content: '',
          fg: DIM_COLOR,
          height: 1,
          flexShrink: 0,
        }),
      );

      r.root.add(rootBox);

      const petTitle = r.root.findDescendantById('pet-title') as TextRenderableType;
      const petSprite = r.root.findDescendantById('pet-sprite') as TextRenderableType;
      const stepArea = r.root.findDescendantById('step-area') as BoxRenderableType;
      const helpBar = r.root.findDescendantById('help-bar') as TextRenderableType;

      // Render initial preview
      petTitle.content = `  ${desired.species} ${RARITY_STARS[desired.rarity]}`;
      petTitle.fg = color;
      petSprite.content = renderAnimatedSprite(previewBones, 0);
      petSprite.fg = color;

      unsubAnimation = animator.subscribe((frame) => {
        const seqEntry = IDLE_SEQUENCE[frame % IDLE_SEQUENCE.length];
        if (seqEntry === lastRenderedFrame) return;
        lastRenderedFrame = seqEntry;
        const bones = foundBones ?? previewBones;
        petSprite.content = renderAnimatedSprite(bones, frame);
      });

      // --- Widget helpers ---
      function nextId(prefix: string): string {
        return `${prefix}-${++widgetCounter}`;
      }

      function clearStep(): void {
        // Blur focused widgets before removing to prevent them from
        // intercepting keypresses after removal
        try {
          activeInput?.blur();
        } catch {
          /* ignore */
        }
        try {
          activeSelect?.blur();
        } catch {
          /* ignore */
        }
        activeInput = null;
        activeSelect = null;
        searchBarText = null;
        searchDetailText = null;
        for (const id of stepWidgetIds) {
          try {
            stepArea.remove(id);
          } catch {
            /* ignore */
          }
        }
        stepWidgetIds = [];
      }

      function addText(content: string, fg = '#ffffff'): TextRenderableType {
        const id = nextId('t');
        stepWidgetIds.push(id);
        stepArea.add(Text({ id, content, fg, height: 1 }));
        return stepArea.findDescendantById(id) as TextRenderableType;
      }

      function addSpacer(): void {
        const id = nextId('s');
        stepWidgetIds.push(id);
        stepArea.add(Text({ id, content: '', height: 1 }));
      }

      function addInput(placeholder: string, onEnter: () => void, width = 50): void {
        const id = nextId('inp');
        stepWidgetIds.push(id);
        stepArea.add(
          Input({
            id,
            placeholder,
            width,
            focusedBackgroundColor: '#1a3a4a',
            focusedTextColor: '#ffffff',
            placeholderColor: '#555555',
          }),
        );
        const inp = stepArea.findDescendantById(id) as InputRenderableType;
        inp.focus();
        activeInput = inp;
        inp.on(InputRenderableEvents.ENTER, onEnter);
      }

      function addSelect(
        options: { name: string; description: string; value: string }[],
      ): SelectRenderableType {
        const id = nextId('sel');
        stepWidgetIds.push(id);
        stepArea.add(
          Select({
            id,
            options,
            height: options.length,
            selectedBackgroundColor: '#1a3a4a',
            selectedTextColor: '#ffffff',
            textColor: '#aaaaaa',
            showScrollIndicator: false,
            wrapSelection: true,
            showDescription: false,
          }),
        );
        const sel = stepArea.findDescendantById(id) as SelectRenderableType;
        sel.focus();
        activeSelect = sel;
        return sel;
      }

      // --- Step rendering ---
      function showStep(step: Step): void {
        currentStep = step;
        clearStep();

        switch (step) {
          case 'confirm_search': {
            const expected = estimateAttempts(desired);
            addText('  Find a matching salt and apply?');
            addSpacer();
            addText(`  ~${formatCount(expected)} attempts expected`, DIM_COLOR);
            helpBar.content = '  Enter/Y confirm    Esc cancel';
            helpBar.fg = FOCUS_BORDER;
            break;
          }

          case 'searching': {
            searchBarText = addText('  Searching...', FOCUS_BORDER);
            addSpacer();
            searchDetailText = addText('  Starting workers...', DIM_COLOR);
            helpBar.content = '  Searching for matching salt...';
            helpBar.fg = DIM_COLOR;
            startSearch();
            break;
          }

          case 'name': {
            const currentName = getCompanionName();
            if (currentName) {
              addText(`  Name your buddy (current: "${currentName}")`);
            } else {
              addText('  Name your buddy');
            }
            addSpacer();
            addInput(currentName ?? 'Enter a name (or skip)', () => {
              const name = (activeInput?.value ?? '').trim();
              if (name) {
                profileName = name;
                doSaveProfile();
                try {
                  renameCompanion(name);
                } catch {
                  /* ignore — companion may not be hatched yet */
                }
              }
              nextAfterName();
            });
            helpBar.content = '  Type a name, then Enter    Enter to skip';
            helpBar.fg = FOCUS_BORDER;
            break;
          }

          case 'personality': {
            addText('  Set companion personality');
            addSpacer();
            const currentPersonality = getCompanionPersonality();
            if (currentPersonality) {
              addText(`  Current: "${currentPersonality.slice(0, 60)}..."`, DIM_COLOR);
              addSpacer();
            }

            const speciesDefault = DEFAULT_PERSONALITIES[desired.species] ?? null;
            const options: { name: string; description: string; value: string }[] = [
              { name: '  Keep current', description: '', value: 'keep' },
            ];
            if (speciesDefault) {
              options.push({
                name: `  Use ${desired.species} default`,
                description: '',
                value: 'default',
              });
            }
            options.push({ name: '  Write custom', description: '', value: 'custom' });
            addSelect(options);
            helpBar.content = '  ↑↓ select    Enter confirm';
            helpBar.fg = FOCUS_BORDER;
            break;
          }

          case 'personality_custom': {
            addText("  Describe your companion's personality:");
            addSpacer();
            addInput(
              'A cheerful companion who...',
              () => {
                const personality = (activeInput?.value ?? '').trim();
                if (personality) {
                  try {
                    setCompanionPersonality(personality);
                  } catch {
                    /* ignore */
                  }
                }
                nextAfterPersonality();
              },
              60,
            );
            helpBar.content = '  Type personality, then Enter';
            helpBar.fg = FOCUS_BORDER;
            break;
          }

          case 'confirm_patch': {
            const running = isClaudeRunning(setup.binaryPath);
            if (running) {
              addText('  Claude Code is running.', DIM_COLOR);
              addText('  Patch is safe (atomic rename) but needs restart.', DIM_COLOR);
              addSpacer();
              addText('  Patch binary? (restart Claude Code after)');
            } else {
              addText('  Patch binary? (backup will be created)');
            }
            helpBar.content = '  Enter/Y patch    N/Esc skip';
            helpBar.fg = FOCUS_BORDER;
            break;
          }

          case 'confirm_hook': {
            // Auto-install so the buddy survives Claude Code auto-updates
            if (!isHookInstalled() && !flags.noHook) {
              installHook();
            }
            showStep('done');
            return;
          }

          case 'done': {
            const running = isClaudeRunning(setup.binaryPath);
            addSpacer();
            if (running) {
              addText('  Done! Quit all Claude Code sessions and relaunch.', RARITY_HEX.legendary);
              addText('  Then run /hatch to meet your new companion.', DIM_COLOR);
            } else {
              addText(
                '  Done! Launch Claude Code and run /hatch to see your new pet.',
                RARITY_HEX.uncommon,
              );
            }
            addSpacer();
            if (profileName) {
              addText(`  Saved as "${profileName}"`, DIM_COLOR);
            }
            addSpacer();
            {
              const repoUrl = 'https://github.com/cpaczek/any-buddy';
              const id = nextId('t');
              stepWidgetIds.push(id);
              const styledContent = new StyledText([
                dimStyle('  If you enjoyed this, '),
                fgStyle(RARITY_HEX.legendary)('★ star'),
                dimStyle(' the repo: '),
                underlineStyle(linkStyle(repoUrl)(repoUrl)),
              ]);
              stepArea.add(Text({ id, height: 1 }));
              const el = stepArea.findDescendantById(id) as TextRenderableType;
              if (el) el.content = styledContent;
            }
            helpBar.content = '  Enter to exit';
            helpBar.fg = DIM_COLOR;
            break;
          }
        }
      }

      // --- Side effects ---
      async function startSearch(): Promise<void> {
        try {
          saltResult = await findSalt(setup.userId, desired, {
            binaryPath: setup.binaryPath,
            onProgress: ({ attempts, rate, pct, eta, workers }) => {
              if (currentStep !== 'searching') return;
              const etaStr =
                eta < 1 ? '<1s' : eta < 60 ? `${Math.ceil(eta)}s` : `${(eta / 60).toFixed(1)}m`;
              const rateStr =
                rate > 1e6 ? `${(rate / 1e6).toFixed(1)}M/s` : `${(rate / 1e3).toFixed(0)}k/s`;
              const pctVal = Math.min(99, Math.floor(pct));
              const barWidth = 30;
              const filled = Math.round((pctVal / 100) * barWidth);
              const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

              if (searchBarText) {
                searchBarText.content = `  ${bar} ${pctVal}%`;
              }
              if (searchDetailText) {
                searchDetailText.content = `  ${formatCount(attempts)} tried   ${rateStr}   ETA ${etaStr}   [${workers} cores]`;
              }
            },
          });

          foundBones = roll(setup.userId, saltResult.salt, {
            useNodeHash: setup.useNodeHash,
          }).bones;

          // Update preview to show found pet
          const foundColor = RARITY_HEX[foundBones.rarity];
          petSprite.content = renderAnimatedSprite(foundBones, 0);
          petSprite.fg = foundColor;
          petTitle.content = `  ${foundBones.species} ${RARITY_STARS[foundBones.rarity]}  ✓ Found!`;
          petTitle.fg = foundColor;

          clearStep();
          const totalStr = saltResult.totalAttempts
            ? `${saltResult.totalAttempts.toLocaleString()} total across ${saltResult.workers} cores`
            : '';
          addText(
            `  Found in ${saltResult.attempts.toLocaleString()} attempts (${(saltResult.elapsed / 1000).toFixed(1)}s)`,
            RARITY_HEX.uncommon,
          );
          if (totalStr) addText(`  ${totalStr}`, DIM_COLOR);
          helpBar.content = '  Enter to continue';
          helpBar.fg = FOCUS_BORDER;
        } catch (err) {
          clearStep();
          addText(`  Search failed: ${(err as Error).message}`, '#ff5555');
          helpBar.content = '  Enter to exit';
          helpBar.fg = '#ff5555';
          currentStep = 'done';
        }
      }

      function doSaveProfile(): void {
        if (!profileName || !saltResult || !foundBones) return;
        saveProfile({
          salt: saltResult.salt,
          species: desired.species,
          rarity: desired.rarity,
          eye: desired.eye,
          hat: desired.hat,
          shiny: desired.shiny,
          stats: foundBones.stats,
          name: profileName,
          personality: null,
          createdAt: new Date().toISOString(),
        });
      }

      function doPatch(): void {
        if (!saltResult) return;
        const existingConfig = loadPetConfig();
        const current = getCurrentSalt(setup.binaryPath);
        let oldSalt: string;
        if (!current.patched) {
          oldSalt = ORIGINAL_SALT;
        } else if (existingConfig?.salt) {
          oldSalt = existingConfig.salt;
          const check = verifySalt(setup.binaryPath, oldSalt);
          if (check.found < getMinSaltCount(setup.binaryPath)) return;
        } else {
          return;
        }

        patchBinary(setup.binaryPath, oldSalt, saltResult.salt);

        const configV2 = loadPetConfigV2() ?? {
          version: 2 as const,
          activeProfile: null,
          salt: ORIGINAL_SALT,
          profiles: {},
        };
        configV2.salt = saltResult.salt;
        configV2.previousSalt = oldSalt;
        configV2.appliedTo = setup.binaryPath;
        configV2.appliedAt = new Date().toISOString();
        if (profileName) configV2.activeProfile = saltResult.salt;
        savePetConfigV2(configV2);
      }

      function updateProfileIdentity(): void {
        if (!saltResult) return;
        const configV2 = loadPetConfigV2();
        const saved = configV2?.profiles[saltResult.salt];
        if (saved) {
          saved.name = profileName || getCompanionName() || saved.name;
          saved.personality = getCompanionPersonality() ?? saved.personality;
          saveProfile(saved, { activate: true });
        }
      }

      function nextAfterPersonality(): void {
        updateProfileIdentity();
        if (flags.yes) {
          doPatch();
          showStep('confirm_hook');
        } else {
          showStep('confirm_patch');
        }
      }

      function hasCompanion(): boolean {
        return !!(getCompanionName() && getCompanionPersonality());
      }

      function nextAfterName(): void {
        if (hasCompanion() && !flags.personality) {
          showStep('personality');
        } else {
          if (flags.personality) {
            try {
              setCompanionPersonality(flags.personality);
            } catch {
              /* ignore */
            }
          }
          nextAfterPersonality();
        }
      }

      // --- Keyboard handler ---
      // Input steps (name, personality_custom) are handled by InputRenderableEvents.ENTER
      // on the widget itself (set up in addInput callbacks). This handler covers
      // confirmations (Y/N), Select steps, and navigation-only steps.
      function handleKeys(key: { name?: string; ctrl?: boolean; stopPropagation?(): void }): void {
        if (key.ctrl) return; // Ctrl+C handled separately

        switch (currentStep) {
          case 'confirm_search':
            if (key.name === 'return' || key.name === 'y') showStep('searching');
            else if (key.name === 'escape' || key.name === 'n') finish();
            break;

          case 'searching':
            if (key.name === 'return' && saltResult) {
              showStep('name');
              // Stop propagation so the Enter that triggered this transition is not
              // delivered to the newly-focused Input widget (which would instantly
              // submit it with an empty value, skipping the name step entirely).
              key.stopPropagation?.();
            }
            break;

          // 'name' and 'personality_custom' — Enter handled by Input widget callbacks

          case 'personality':
            if (key.name === 'return' && activeSelect) {
              const idx = activeSelect.getSelectedIndex();
              const speciesDefault = DEFAULT_PERSONALITIES[desired.species] ?? null;
              const values = speciesDefault ? ['keep', 'default', 'custom'] : ['keep', 'custom'];
              const choice = values[idx];

              if (choice === 'keep') {
                nextAfterPersonality();
              } else if (choice === 'default' && speciesDefault) {
                try {
                  setCompanionPersonality(speciesDefault);
                } catch {
                  /* ignore */
                }
                nextAfterPersonality();
              } else {
                showStep('personality_custom');
                // Same as above: stop propagation so the Enter that selected
                // "Write custom" is not delivered to the newly-focused Input.
                key.stopPropagation?.();
              }
            }
            break;

          case 'confirm_patch':
            if (key.name === 'return' || key.name === 'y') {
              doPatch();
              showStep('confirm_hook');
            } else if (key.name === 'escape' || key.name === 'n') {
              showStep('confirm_hook');
            }
            break;

          case 'done':
            if (key.name === 'return' || key.name === 'escape') finish();
            break;
        }
      }

      r.keyInput.on('keypress', handleCtrlC);
      r.keyInput.on('keypress', handleKeys);
      r.auto();

      showStep(currentStep);
    });
  } catch (err) {
    if (renderer) {
      try {
        renderer.destroy();
      } catch {
        /* ignore */
      }
    }
    console.error(`  Apply TUI error: ${(err as Error).message}`);
    console.error(`  If this persists, please report at: ${ISSUE_URL}`);
  }
}
