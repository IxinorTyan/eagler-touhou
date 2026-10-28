// @ts-nocheck
import {trackerCellEdges} from './tracker-grid';
// Canvas layout and pixel drawing adapted from Doopu's Touhou 1CC Tracker.
// Source: https://github.com/doopu/1ccTracker/blob/main/index.js
// Browser controls and storage are owned by CareerShowcase; each renderer is isolated.
class Character {
    constructor(name, subcharacters = []) {
        this.name = name;
        this.subcharacters = subcharacters.slice();
    }
}
class BoxObject {
    constructor(name) {
        this.name = name;
        this.textColour = '#000000';
        this.cellColour = '#FFFFFF';
        this.done = false;
        this.pacifist = false;
        this.unique = false;
        this.focus = false;
        this.vertical = false;
        this.lives = null;
        this.bombs = null;
        this.misses = null;
    }
}
class Game {
    constructor(name, colour, difficulties, characters) {
        this.name = name;
        this.colour = colour;
        this.difficulties = difficulties.slice();
        this.characters = characters.slice();
    }
}
const htrp = new Game("HRTP", "rgba(210, 60, 255, 1.0)", "LHN".split(''), [new Character("", ["ma", "j"])]);
const soew = new Game("SOEW", "rgba(32, 51, 255, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b", "c"])]);
const podd = new Game("PODD", "rgba(255, 92, 92, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("MI"),
    new Character("M"),
    new Character("EL"),
    new Character("KH"),
    new Character("KA"),
    new Character("RI"),
    new Character("CH"),
    new Character("YM")]);
const ls = new Game("LS", "rgba(73, 250, 76, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b"]),
    new Character("M", ["a", "b"])]);
const ms = new Game("MS", "rgba(194, 36, 128, 1.0)", "XLHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("MI"),
    new Character("YK")]);
const eosd = new Game("EOSD", "rgba(255, 51, 18, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b"]),
    new Character("M", ["a", "b"])]);
const stb = new Game("STB", "rgba(99, 44, 0, 1.0)", ["85", "66"], [new Character("AY")]);
const ds = new Game("DS", "rgba(10, 34, 119, 1.0)", ["108", "58"], [new Character("AY"), new Character("HA")]);
const isc = new Game("ISC", "rgba(99, 44, 0, 1.0)", ["NI", "C"], [new Character("SJ")]);
const vd = new Game("VD", "rgba(163, 73, 164, 1.0)", ["103", "C"], [new Character("SM")]);
const bm = new Game("100BM", "rgba(232, 125, 0, 1.0)", ["85", "C"], [new Character("M")]);
const pcb = new Game("PCB", "rgba(255, 127, 191, 1.0)", "PXLHN".split(''), [new Character("R", ["a", "b"]),
    new Character("M", ["a", "b"]),
    new Character("S", ["a", "b"])]);
const imp = new Game("IN", "rgba(196, 101, 0, 1.0)", ["X", "B-L", "B-H", "B-N", "A-L", "A-H", "A-N"], [new Character("BT"),
    new Character("MT"),
    new Character("ST"),
    new Character("NT"),
    new Character("R"),
    new Character("YU"),
    new Character("M"),
    new Character("A"),
    new Character("S"),
    new Character("RE"),
    new Character("Y"),
    new Character("YY")]);
const pofv = new Game("POFV", "rgba(16, 15, 107, 1.0)", "XLHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("S"),
    new Character("Y"),
    new Character("RS"),
    new Character("C"),
    new Character("L"),
    new Character("MY"),
    new Character("T"),
    new Character("AY"),
    new Character("ME"),
    new Character("YK"),
    new Character("K"),
    new Character("E")]);
const mof = new Game("MOF", "rgba(255, 168, 0, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b", "c"]),
    new Character("M", ["a", "b", "c"])]);
const sa = new Game("SA", "rgba(0, 201, 109, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b", "c"]),
    new Character("M", ["a", "b", "c"])]);
const ufo = new Game("UFO", "rgba(127, 191, 255, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b"]),
    new Character("M", ["a", "b"]),
    new Character("SN", ["a", "b"])]);
const gfw = new Game("GFW", "rgba(127, 253, 255, 1.0)", "LHN".split(''), [new Character("A1"),
    new Character("A2"),
    new Character("B1"),
    new Character("B2"),
    new Character("C1"),
    new Character("C2"),
    new Character("EX")]);
const td = new Game("TD", "rgba(255, 191, 127, 1.0)", "XLHN".split(''), [new Character("R", ["e1", "e2"]),
    new Character("M", ["e1", "e2"]),
    new Character("SN", ["e1", "e2"]),
    new Character("Y", ["e1", "e2"])]);
const ddc = new Game("DDC", "rgba(123, 95, 135, 1.0)", "XLHN".split(''), [new Character("R", ["a", "b"]),
    new Character("M", ["a", "b"]),
    new Character("S", ["a", "b"])]);
const lolk = new Game("LOLK", "rgba(159, 21, 41, 1.0)", "XLHN".split(''), [new Character("R", ["p", "l"]),
    new Character("M", ["p", "l"]),
    new Character("SN", ["p", "l"]),
    new Character("RS", ["p", "l"])]);
const hsifs = new Game("HSIFS", "rgba(255, 127, 39, 1.0)", "XLHN".split(''), [new Character("R", ["sp", "sm", "f", "w"]),
    new Character("C", ["sp", "sm", "f", "w"]),
    new Character("AY", ["sp", "sm", "f", "w"]),
    new Character("M", ["sp", "sm", "f", "w"])]);
const wbawc = new Game("WBAWC", "rgba(224, 66, 44, 1.0)", "XLHN".split(''), [new Character("R", ["w", "o", "e"]),
    new Character("M", ["w", "o", "e"]),
    new Character("Y", ["w", "o", "e"])]);
const um = new Game("UM", "rgba(0, 201, 109, 1.0)", "XLHN".split(''), [new Character("R", ["e1", "e2"]),
    new Character("M", ["e1", "e2"]),
    new Character("S", ["e1", "e2"]),
    new Character("SN", ["e1", "e2"])]);
const udoalg = new Game("UDOALG", "rgba(74, 124, 71, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("SN"),
    new Character("RA"),
    new Character("A"),
    new Character("N"),
    new Character("SR"),
    new Character("RI"),
    new Character("TS"),
    new Character("MM"),
    new Character("YC"),
    new Character("SK"),
    new Character("YT"),
    new Character("SU"),
    new Character("BS"),
    new Character("EN"),
    new Character("CY"),
    new Character("H"),
    new Character("Z")]);
const iamp = new Game("IAMP", "rgba(78, 22, 86, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("S"),
    new Character("A"),
    new Character("P"),
    new Character("Y"),
    new Character("RE"),
    new Character("YY"),
    new Character("YU"),
    new Character("SU")]);
const swr = new Game("SWR", "rgba(255, 51, 18, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("S"),
    new Character("A"),
    new Character("P"),
    new Character("Y"),
    new Character("RE"),
    new Character("YY"),
    new Character("YU"),
    new Character("SU"),
    new Character("RS"),
    new Character("AY"),
    new Character("K"),
    new Character("I"),
    new Character("TE")]);
const hsoku = new Game("H.SOKU", "rgba(210, 210, 210, 1.0)", "LHN".split(''), [new Character("SN"),
    new Character("C"),
    new Character("ML")]);
const hm = new Game("HM", "rgba(179, 193, 148, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("IC"),
    new Character("B"),
    new Character("F"),
    new Character("TO"),
    new Character("N"),
    new Character("KO"),
    new Character("MA"),
    new Character("KK")]);
const ulil = new Game("ULIL", "rgba(0, 136, 148, 1.0)", "LHN".split(''), [new Character("R1"),
    new Character("M"),
    new Character("IC"),
    new Character("B"),
    new Character("F"),
    new Character("TO"),
    new Character("N"),
    new Character("KO"),
    new Character("MA"),
    new Character("KK"),
    new Character("MO"),
    new Character("SH"),
    new Character("KA"),
    new Character("SM"),
    new Character("R2")]);
const aocf = new Game("AOCF", "rgba(201, 143, 255, 1.0)", "LHN".split(''), [new Character("R"),
    new Character("M"),
    new Character("N"),
    new Character("MA"),
    new Character("TO"),
    new Character("F"),
    new Character("RS"),
    new Character("SM"),
    new Character("TE"),
    new Character("YU"),
    new Character("J")]);
const gi = new Game("GI", "rgba(131, 5, 5, 1.0)", "HN".split(''), [new Character("R"),
    new Character("M"),
    new Character("KA"),
    new Character("MU"),
    new Character("J"),
    new Character("FL", ["a", "b", "c"]),
    new Character("YT")]);

export const trackerGames = [htrp, soew, podd, ls, ms, eosd, stb, ds, isc, vd, bm, pcb, imp, pofv, mof, sa, ufo, gfw, td, ddc, lolk, hsifs, wbawc, um, udoalg, iamp, swr, hsoku, hm, ulil, aocf, gi];
export const trackerSections = [
    {title: '整数作', games: [htrp, soew, ls, ms, eosd, pcb, imp, mof, sa, ufo, td, ddc, lolk, hsifs, wbawc, um]},
    {title: '对战作', games: [podd, pofv, udoalg]},
    {title: '小数点作', games: [iamp, stb, swr, hsoku, ds, gfw, hm, isc, ulil, aocf, vd, bm, gi]},
];
const additionalGames = new Set([iamp, swr, hsoku, hm, ulil, aocf, gi]);
function gameDifficulties(game, easy) {
    if (game.name === 'IN') return easy
        ? ['X', 'B-L', 'B-H', 'B-N', 'B-E', 'A-L', 'A-H', 'A-N', 'A-E']
        : ['X', 'B-L', 'B-H', 'B-N', 'A-L', 'A-H', 'A-N'];
    return [...game.difficulties, ...(easy && game.difficulties.at(-1) === 'N' ? ['E'] : [])];
}
export function trackerLayout(options) {
    let y = 24;
    const sections = trackerSections.map(section => {
        const top = y;
        y += 42;
        let x = 24, rowHeight = 0;
        const games = section.games.filter(game => options.extra || !additionalGames.has(game)).map(game => {
            const columns = game.characters.reduce((n, character) => n + (character.subcharacters.length || 1), 0);
            const width = columns * 17 + 30;
            const height = gameDifficulties(game, options.easy).length * 17 + 44;
            if (x + width > 776) {y += rowHeight + 20; x = 24; rowHeight = 0;}
            const block = {game, x, y, width, height};
            x += width + 20;
            rowHeight = Math.max(rowHeight, height);
            return block;
        });
        y += rowHeight + 30;
        return {title: section.title, top, games};
    });
    return {width: 800, height: y + (options.legend ? 98 : 0), sections};
}
export function createTrackerRenderer(surface) {
const ctx = surface.getContext('2d');
const canvas = {width: 800, height: 878};
let transparentPng = false, showLegend = true, easyMode = true;
let state = new Map();
function getBoxFromState(key) {return state.get(key) ?? new BoxObject(key);}
const boxWidth = 17;
function drawBox(x, y, width = boxWidth, height = boxWidth, lineWidth = 1.0, strokeStyle = '#d8d4cb') {
    if (ctx) {
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x, y, width, height);
    }
}
function drawBoxContentsAux(x, y, done, misses, bombs, lives, vertical, focus, pacifist, unique, cellColour, textColour, colour) {
    if (ctx) {
        if (done) {
            ctx.fillStyle = colour;
        }
        else {
            ctx.fillStyle = cellColour;
        }
        ctx.save();
        if (done) ctx.globalAlpha = .30;
        ctx.fillRect(x, y, boxWidth, boxWidth);
        ctx.restore();
        // Draw the little bits and pieces
        // Draw miss/bomb/starting counts
        if (misses) {
            drawText(misses, x + 2, y + 7, 'left', '500 7px "Segoe UI", sans-serif', textColour);
        }
        if (bombs) {
            drawText(bombs, x + 7, y + 7, 'left', '500 7px "Segoe UI", sans-serif', textColour);
        }
        if (lives) {
            drawText(lives, x + 16, y + 7, 'right', '500 7px "Segoe UI", sans-serif', textColour);
        }
        // No vertical?
        if (vertical) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = textColour;
            ctx.beginPath();
            ctx.lineTo(x + 1.5, y + boxWidth / 2 - 0.5);
            ctx.lineTo(x + boxWidth - 2.5, y + boxWidth / 2 - 0.5);
            ctx.stroke();
        }
        // No focus / pacifist / unique
        if (focus) {
            drawText("F", x + 2, y + 15, 'left', '500 7px "Segoe UI", sans-serif', textColour);
        }
        if (pacifist) {
            drawText("P", x + 7, y + 15, 'left', '500 7px "Segoe UI", sans-serif', textColour);
        }
        if (unique) {
            drawText("U", x + 12, y + 15, 'left', '500 7px "Segoe UI", sans-serif', textColour);
        }
    }
}
function drawBoxContents(x, y, boxName, colour) {
    const box = getBoxFromState(boxName);
    drawBoxContentsAux(x, y, box.done, box.misses, box.bombs, box.lives, box.vertical, box.focus, box.pacifist, box.unique, box.cellColour, box.textColour, colour);
}
function drawText(text, x, y, align = 'left', font = '600 8px "Segoe UI", sans-serif', colour = "#48443d") {
    x -= 0.5; // Dumb hack for Windows
    if (ctx) {
        ctx.font = font;
        ctx.textAlign = align;
        ctx.fillStyle = colour;
        ctx.fillText(text, x, y - 1);
    }
}
function drawUILine(x, y, drop, width) {
    if (ctx) {
        ctx.beginPath();
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + drop);
        ctx.strokeStyle = '#d8d4cb';
        ctx.lineWidth = width;
        ctx.stroke();
    }
}
function drawDot(colour, x, y, width = 2) {
    if (ctx) {
        ctx.beginPath();
        ctx.fillStyle = colour;
        ctx.arc(x, y, width, 0, 2 * Math.PI);
        ctx.fill();
    }
}
let boxes = [];
function drawCellGrid(cells) {
    const edges = trackerCellEdges(cells, boxWidth);
    ctx.strokeStyle = '#d8d4cb';
    ctx.lineJoin = 'miter';
    // Each shared edge is stroked once. Thick outlines follow the actual cell union,
    // including the stepped Extra rows, instead of a separately offset shape.
    for (const outer of [false, true]) {
        ctx.lineWidth = outer ? 2 : 1;
        ctx.lineCap = outer ? 'square' : 'butt';
        ctx.beginPath();
        for (const edge of edges) {
            if (edge.outer !== outer) continue;
            ctx.moveTo(edge.x1, edge.y1);
            ctx.lineTo(edge.x2, edge.y2);
        }
        ctx.stroke();
    }
}
function drawGame(game, baseX, baseY, drawDifficulties = false) {
    // All grid, outline, label and hit-target coordinates share the same pixel lattice.
    baseX = Math.round(baseX * 2) / 2;
    baseY = Math.round(baseY * 2) / 2;
    const characters = game.characters.flatMap(character => character.subcharacters.length
        ? character.subcharacters.map(sub => character.name + sub) : [character.name]);
    const difficulties = gameDifficulties(game, easyMode);
    if (drawDifficulties) {
        difficulties.forEach((difficulty, row) => {
            drawText(difficulty, baseX + 24, baseY + (row + 1) * boxWidth - 5, 'right');
        });
        baseX += 30;
    }
    const dotOffset = characters.length === 1 ? -6 : 0;
    const nameOffset = ['GFW', 'PODD'].includes(game.name) ? 4 : 3;
    drawDot(game.colour, baseX + nameOffset + dotOffset, baseY - 5);
    drawText(game.name, baseX + nameOffset + 4 + dotOffset, baseY - 2);
    const gameCells = [];
    characters.forEach((character, column) => difficulties.forEach((difficulty, row) => {
        if ((game.name === 'GFW' && character === 'EX' && difficulty !== 'N') ||
            (game.name === 'LOLK' && !character.endsWith('l') && difficulty === 'X') ||
            (game.name === 'HSIFS' && !character.endsWith('sp') && difficulty === 'X') ||
            (['TD', 'UM'].includes(game.name) && character.endsWith('2') && difficulty === 'X')) return;
        const actualRow = row + (game.name === 'GFW' && character === 'EX' && easyMode ? 1 : 0);
        const cell = {key: `${game.name}-${character}-${difficulty}`, x: baseX + column * boxWidth, y: baseY + actualRow * boxWidth};
        gameCells.push(cell);
        boxes.push(cell);
        drawBoxContents(cell.x, cell.y, cell.key, game.colour);
    }));
    drawCellGrid(gameCells);
    const bottom = baseY + difficulties.length * boxWidth;
    let column = 0;
    for (const character of game.characters) {
        const x = baseX + column * boxWidth;
        // Retain the original character grouping, aligned exactly to the cell edge.
        drawUILine(x, bottom, character.subcharacters.length ? boxWidth - 2 : boxWidth - 8, column === 0 ? 2 : 1);
        if (character.subcharacters.length) {
            drawText(character.name, x + 2, bottom + 14);
            for (const [index, sub] of character.subcharacters.entries())
                drawText(sub, x + index * boxWidth + 2, bottom + 7, 'left', '500 7px "Segoe UI", sans-serif');
            column += character.subcharacters.length;
        } else {
            drawText(character.name, x + 2, bottom + 8);
            column++;
        }
    }
    drawUILine(baseX + column * boxWidth, bottom, boxWidth - 8, 2);
}
function drawLegend(y) {
    ctx.fillStyle = '#f6f3ed';
    ctx.fillRect(24, y, 752, 72);
    drawBox(38, y + 18, 48, 32, 1, '#c9c0b1');
    drawText('2   0   3', 44, y + 33);
    drawText('F   P   U', 44, y + 46);
    drawText('MISS / BOMB / START LIVES', 102, y + 29);
    drawText('NV  NO VERTICAL     F  NO FOCUS     P  PACIFIST     U  UNIQUE RULE', 102, y + 47);
}
function drawScreen(layout) {
    boxes = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!transparentPng) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const section of layout.sections) {
        drawText(section.title, 24, section.top + 14, 'left', '600 14px "Segoe UI", "Microsoft YaHei", sans-serif');
        ctx.strokeStyle = '#d8d4cb';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(106, section.top + 9); ctx.lineTo(776, section.top + 9); ctx.stroke();
        for (const block of section.games) drawGame(block.game, block.x, block.y, true);
    }
    if (showLegend) drawLegend(layout.height - 98);
}

return {draw(records, options) {
    state = new Map(Object.entries(records));
    transparentPng = options.transparent; showLegend = options.legend; easyMode = options.easy;
    const layout = trackerLayout(options);
    canvas.width = layout.width;
    canvas.height = layout.height;
    surface.width = canvas.width * 2;
    surface.height = canvas.height * 2;
    ctx.scale(2, 2);
    drawScreen(layout);
    return boxes.map(({key, x, y}) => ({key, x, y}));
}};
}
