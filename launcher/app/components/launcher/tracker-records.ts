import {trackerGames} from './tracker-renderer';
import {readBookPreference} from './book-preferences';

export type TrackerRecord = {name: string; done: boolean; misses: string | null; bombs: string | null; lives: string | null;
  vertical: boolean; focus: boolean; pacifist: boolean; unique: boolean; cellColour: string; textColour: string;
  note?: string; challenge?: string; continued?: boolean};
export type CareerRecords = Record<string, TrackerRecord>;
export type TrackerOptions = {easy: boolean; extra: boolean; legend: boolean; transparent: boolean};
export const DEFAULT_OPTIONS: TrackerOptions = {easy: true, extra: true, legend: true, transparent: false};
export const CAREER_STORAGE_KEY = 'player-career-chart-v2';
const titles = ['东方灵异传', '东方封魔录', '东方梦时空', '东方幻想乡', '东方怪绮谈', '东方红魔乡', '东方文花帖', '东方文花帖 DS', '弹幕天邪鬼', '秘封噩梦日记', '弹幕狂们的黑市', '东方妖妖梦', '东方永夜抄', '东方花映塚', '东方风神录', '东方地灵殿', '东方星莲船', '妖精大战争', '东方神灵庙', '东方辉针城', '东方绀珠传', '东方天空璋', '东方鬼形兽', '东方虹龙洞', '东方兽王园', '东方萃梦想', '东方绯想天', '东方非想天则', '东方心绮楼', '东方深秘录', '东方凭依华', '东方刚欲异闻', '东方锦上京'];
export type TrackerGame = {name: string; colour: string; title: string; characters: string[]; difficulties: string[]};
type SourceGame = {name: string; colour: string; characters: {name: string; subcharacters: string[]}[]; difficulties: string[]};
export const TRACKER_GAMES: TrackerGame[] = (trackerGames as unknown as SourceGame[]).map((game, index) => ({
  name: game.name, colour: game.colour, title: titles[index],
  characters: game.characters.flatMap(character => character.subcharacters.length ? character.subcharacters.map(sub => character.name + sub) : [character.name]),
  difficulties: game.name === 'IN' ? ['X', 'B-L', 'B-H', 'B-N', 'B-E', 'A-L', 'A-H', 'A-N', 'A-E'] : [...game.difficulties, ...(game.difficulties.at(-1) === 'N' ? ['E'] : [])],
}));
export function cellAvailable(game: string, character: string, difficulty: string) {
  return !(game === 'GFW' && character === 'EX' && difficulty !== 'N') &&
    !(game === 'LOLK' && !character.endsWith('l') && difficulty === 'X') &&
    !(game === 'HSIFS' && !character.endsWith('sp') && difficulty === 'X') &&
    !(['TD', 'UM'].includes(game) && character.endsWith('2') && difficulty === 'X');
}
export const TRACKER_CELLS = TRACKER_GAMES.flatMap(game => game.characters.flatMap(character => game.difficulties
  .filter(difficulty => cellAvailable(game.name, character, difficulty)).map(difficulty => ({key: `${game.name}-${character}-${difficulty}`, game, character, difficulty}))));
const keys = new Set(TRACKER_CELLS.map(cell => cell.key));
export const blankRecord = (name: string): TrackerRecord => ({name, done: false, misses: null, bombs: null, lives: null, vertical: false, focus: false, pacifist: false, unique: false, cellColour: '#ffffff', textColour: '#000000'});
const count = (value: unknown) => value === null || (typeof value === 'string' && /^[0-9]$/.test(value));
export function validCareerRecords(value: unknown): value is CareerRecords {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (!keys.has(key) || !item || typeof item !== 'object' || Array.isArray(item)) return false;
    const r = item as TrackerRecord;
    return r.name === key && ['done', 'vertical', 'focus', 'pacifist', 'unique'].every(flag => typeof r[flag as keyof TrackerRecord] === 'boolean') &&
      [r.misses, r.bombs, r.lives].every(count) && /^#[\da-f]{6}$/i.test(r.cellColour) && /^#[\da-f]{6}$/i.test(r.textColour) &&
      (r.note === undefined || (typeof r.note === 'string' && r.note.length <= 240)) &&
      (r.challenge === undefined || (typeof r.challenge === 'string' && r.challenge.length <= 24)) &&
      (r.continued === undefined || typeof r.continued === 'boolean');
  });
}
export const validOptions = (value: unknown): value is TrackerOptions => !!value && typeof value === 'object' &&
  Object.keys(DEFAULT_OPTIONS).every(key => typeof (value as Record<string, unknown>)[key] === 'boolean');
const difficultyNames: Record<string, string> = {E: 'Easy', N: 'Normal', H: 'Hard', L: 'Lunatic', X: 'Extra', P: 'Phantasm'};
const cellsByKey = new Map(TRACKER_CELLS.map(cell => [cell.key, cell]));
export function cellLabel(key: string) {
  const cell = cellsByKey.get(key);
  if (!cell) return key;
  return `${cell.game.title} · ${cell.character} · ${difficultyNames[cell.difficulty] ?? cell.difficulty}`;
}
export function loadCareerRecords() {
  return readBookPreference(CAREER_STORAGE_KEY, {}, validCareerRecords);
}
