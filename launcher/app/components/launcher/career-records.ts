import {PRODUCT_GAMES, multiplayerConfigForProduct} from '../../../src/contracts/product-catalog.mts';
import type {UiMessageKey} from '../../../src/launcher/i18n.mts';

export const CAREER_STATUSES = [
  {id: 'clear', label: '续关通关', detail: '使用续关完成流程'},
  {id: '1cc', label: '1CC', detail: '不续关通关'},
  {id: 'nm', label: 'NM', detail: 'No Miss · 无失误 1CC'},
  {id: 'nb', label: 'NB', detail: 'No Bomb · 无 Bomb 1CC'},
  {id: 'nn', label: 'NN', detail: 'No Miss + No Bomb · 双无 1CC'},
] as const;
export type CareerStatus = typeof CAREER_STATUSES[number]['id'];
export const CAREER_RESTRICTIONS = [
  {id: 'nv', label: 'NV', detail: 'No Vertical · 禁止纵向移动'},
  {id: 'nf', label: 'NF', detail: 'No Focus · 禁止低速'},
  {id: 'pacifist', label: 'P', detail: 'Pacifist · 和平主义'},
  {id: 'special', label: '★', detail: '特殊限制（在备注中说明）'},
] as const;
export type CareerRestriction = typeof CAREER_RESTRICTIONS[number]['id'];
export type CareerRecord = {status: CareerStatus; misses?: number; bombs?: number; restrictions?: CareerRestriction[]; challenge?: string; note?: string};
// Keep accepting v1 booleans as ordinary 1CCs; saving never discards old cells.
export type CareerRecords = Record<string, true | CareerRecord>;
export const careerRecord = (value: CareerRecords[string] | undefined): CareerRecord | undefined => value === true ? {status: '1cc'} : value;
export const careerStatus = (status: CareerStatus) => CAREER_STATUSES.find(item => item.id === status)!;
export const careerIs1cc = (value: CareerRecords[string] | undefined) => !!value && careerRecord(value)!.status !== 'clear';
export function careerWithCounts(record: CareerRecord, misses: number | undefined, bombs: number | undefined): CareerRecord {
  const status = record.status === 'clear' ? 'clear' : misses === 0 && bombs === 0 ? 'nn' : misses === 0 ? 'nm' : bombs === 0 ? 'nb' : '1cc';
  return {...record, status, misses, bombs};
}
export const careerPreset = (status: CareerStatus): CareerRecord => ({status,
  ...(status === 'nm' || status === 'nn' ? {misses: 0} : {}), ...(status === 'nb' || status === 'nn' ? {bombs: 0} : {})});
export const careerDescription = (value: CareerRecords[string] | undefined) => {
  const record = careerRecord(value);
  return record ? [careerStatus(record.status).detail, record.misses === undefined ? '' : `${record.misses} Miss`,
    record.bombs === undefined ? '' : `${record.bombs} Bomb`, ...(record.restrictions ?? []).map(id => CAREER_RESTRICTIONS.find(item => item.id === id)!.detail), record.challenge, record.note].filter(Boolean).join(' · ') : '尚无记录';
};
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
const validRecord = (value: unknown): value is CareerRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as CareerRecord;
  const count = (n: unknown) => n === undefined || (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 9999);
  if (!CAREER_STATUSES.some(item => item.id === record.status) || !count(record.misses) || !count(record.bombs) ||
    !(record.challenge === undefined || (typeof record.challenge === 'string' && record.challenge.length <= 24)) ||
    !(record.note === undefined || (typeof record.note === 'string' && record.note.length <= 240)) ||
    !(record.restrictions === undefined || (Array.isArray(record.restrictions) && record.restrictions.length <= CAREER_RESTRICTIONS.length &&
      new Set(record.restrictions).size === record.restrictions.length && record.restrictions.every(id => CAREER_RESTRICTIONS.some(item => item.id === id))))) return false;
  if ((record.status === 'nm' || record.status === 'nn') && record.misses !== 0) return false;
  if ((record.status === 'nb' || record.status === 'nn') && record.bombs !== 0) return false;
  return careerWithCounts(record, record.misses, record.bombs).status === record.status;
};
export const validCareerRecords = (value: unknown): value is CareerRecords => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.entries(value).every(([key, record]) => allowedKeys.has(key) && (record === true || validRecord(record)));
export const careerCount = (game: CareerGame, records: CareerRecords) => game.difficulties.reduce((count, difficulty) => count +
  (careerCellAvailable(game, difficulty) ? game.loadouts.filter(loadout => careerIs1cc(records[careerCellKey(game, difficulty, loadout.id)])).length : 0), 0);
export const careerDifficulties = (game: CareerGame, records: CareerRecords) => game.difficulties.filter(difficulty =>
  careerCellAvailable(game, difficulty) && game.loadouts.some(loadout => careerIs1cc(records[careerCellKey(game, difficulty, loadout.id)])));
export const careerBest = (game: CareerGame, difficulty: string, records: CareerRecords) => {
  const statuses = new Set(game.loadouts.map(loadout => careerRecord(records[careerCellKey(game, difficulty, loadout.id)])?.status));
  if (statuses.has('nn')) return 'NN';
  // NM and NB from different runs must never be combined into NN.
  return ['nm', 'nb'].filter(status => statuses.has(status as CareerStatus)).map(status => status.toUpperCase()).join(' / ') || '1CC';
};
