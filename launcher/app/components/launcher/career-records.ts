import {PRODUCT_GAMES, multiplayerConfigForProduct} from '../../../src/contracts/product-catalog.mts';
import type {UiMessageKey} from '../../../src/launcher/i18n.mts';

export type CareerRecords = Record<string, true>;
export const CAREER_STORAGE_KEY = 'player-career-v1';
// A career describes solo runs. Multiplayer supplies shared character names,
// while the table below owns solo-specific routes, endings and difficulty rules.
const ids = ['th06', 'th07', 'th08', 'th09', 'th10', 'th11', 'th15'] as const;
export type CareerGameId = typeof ids[number];
const partners = ['灵梦 × 紫', '灵梦 × 萃香', '灵梦 × 文', '魔理沙 × 爱丽丝', '魔理沙 × 帕秋莉', '魔理沙 × 荷取'];
const notes: Partial<Record<CareerGameId, string>> = {
  th06: 'Easy 在五面结束，因此不计入完整通关。',
  th07: 'Extra 与 Phantasm 分开记录。',
  th08: '本表记录 Final B 通关；Extra 单独记录。',
  th09: '本表记录故事模式；梅露兰、露娜萨不适用故事模式。',
  th11: 'A / B / C 分别对应不同支援角色。',
  th15: '本表记录传统模式（Legacy）；不计入绀珠模式（Pointdevice）。',
};

export const CAREER_GAMES = ids.map(id => {
  const config = multiplayerConfigForProduct(`${id}mp`)!;
  return {
    id, ...PRODUCT_GAMES[id], note: notes[id],
    difficulties: [...config.difficulties],
    loadouts: config.loadouts.filter((_, index) => id !== 'th09' || index < 14).map((loadout, index) => ({
      id: `${loadout.character}-${loadout.shot}`,
      labelKey: loadout.labelKey as UiMessageKey,
      label: id === 'th11' ? partners[index] : undefined,
    })),
  };
});
export type CareerGame = typeof CAREER_GAMES[number];
export const careerCellKey = (game: CareerGame, difficulty: string, loadoutId: string) => `${game.id}:${difficulty}:${loadoutId}`;
export const careerCellAvailable = (game: CareerGame, difficulty: string) => !(game.id === 'th06' && difficulty === 'Easy');
const allowedKeys = new Set(CAREER_GAMES.flatMap(game => game.difficulties.filter(difficulty => careerCellAvailable(game, difficulty))
  .flatMap(difficulty => game.loadouts.map(loadout => careerCellKey(game, difficulty, loadout.id)))));
export const validCareerRecords = (value: unknown): value is CareerRecords => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.entries(value).every(([key, completed]) => allowedKeys.has(key) && completed === true);
export const careerCount = (game: CareerGame, records: CareerRecords) => game.difficulties.reduce((count, difficulty) => count +
  (careerCellAvailable(game, difficulty) ? game.loadouts.filter(loadout => records[careerCellKey(game, difficulty, loadout.id)]).length : 0), 0);
export const careerDifficulties = (game: CareerGame, records: CareerRecords) => game.difficulties.filter(difficulty =>
  careerCellAvailable(game, difficulty) && game.loadouts.some(loadout => records[careerCellKey(game, difficulty, loadout.id)]));
