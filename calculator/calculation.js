// Preliminary rectangular-room take-off. Spacings are editable project assumptions,
// not a replacement for the ceiling manufacturer's installation specification.
export const DEFAULTS = Object.freeze({
  mode: 'dimensions', length: 5, width: 4, area: 20, ratio: 1,
  slatWidth: 50, slatHeight: 100, gap: 50, orientation: 'length',
  stringerSpacing: 1, hangerSpacing: 0.6, fixingSpacing: 0.5,
  reserve: 5, slatStock: 6, stringerStock: 3, angleStock: 3, color: '9006',
});

export class CalculatorInputError extends RangeError {
  constructor(field, message) { super(message); this.name = 'CalculatorInputError'; this.field = field; }
}

export function decimal(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const normalized = value.trim().replace(',', '.');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}

const limits = {
  length: [0.2, 100, 'Длина помещения'], width: [0.2, 100, 'Ширина помещения'],
  area: [0.04, 10000, 'Площадь'], ratio: [0.1, 10, 'Соотношение сторон'],
  slatWidth: [20, 200, 'Ширина рейки'], slatHeight: [20, 200, 'Высота рейки'],
  gap: [0, 200, 'Зазор'], stringerSpacing: [0.2, 2, 'Шаг гребёнок'],
  hangerSpacing: [0.15, 1.2, 'Шаг подвесов'], fixingSpacing: [0.1, 1, 'Шаг крепежа уголка'],
  reserve: [0, 30, 'Запас'], slatStock: [1, 6, 'Длина заготовки рейки'],
  stringerStock: [1, 6, 'Длина заготовки гребёнки'], angleStock: [1, 6, 'Длина заготовки уголка'],
};

function number(input, field) {
  const [min, max, label] = limits[field];
  const value = decimal(input[field]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new CalculatorInputError(field, `${label}: введите число от ${min} до ${max}.`);
  }
  return value;
}

// Floating point noise must not create an extra row/stock piece at exact multiples.
export const ceilCount = value => Math.ceil(value - 1e-9);
export const floorCount = value => Math.floor(value + 1e-9);
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export function calculateCeiling(values = {}) {
  const raw = { ...DEFAULTS, ...values };
  if (!['dimensions', 'area'].includes(raw.mode)) throw new CalculatorInputError('mode', 'Неизвестный режим расчёта.');
  if (!['length', 'width'].includes(raw.orientation)) throw new CalculatorInputError('orientation', 'Выберите направление реек.');
  const input = { mode: raw.mode, orientation: raw.orientation, color: String(raw.color) };
  for (const field of ['slatWidth', 'slatHeight', 'gap', 'stringerSpacing', 'hangerSpacing', 'fixingSpacing', 'reserve', 'slatStock', 'stringerStock', 'angleStock']) {
    input[field] = number(raw, field);
  }
  if (raw.mode === 'area') {
    input.area = number(raw, 'area');
    input.ratio = number(raw, 'ratio');
    input.length = Math.sqrt(input.area * input.ratio);
    input.width = Math.sqrt(input.area / input.ratio);
    number(input, 'length'); number(input, 'width');
  } else {
    input.length = number(raw, 'length'); input.width = number(raw, 'width');
    input.area = input.length * input.width;
    input.ratio = input.length / input.width;
  }
  const { length, width } = input;
  const run = input.orientation === 'length' ? length : width;
  const cross = input.orientation === 'length' ? width : length;
  const pitchMm = input.slatWidth + input.gap;
  const slatRows = Math.max(1, floorCount((cross * 1000 + input.gap) / pitchMm));
  const occupied = (slatRows * input.slatWidth + (slatRows - 1) * input.gap) / 1000;
  const stringerRows = Math.max(2, ceilCount(run / input.stringerSpacing));
  const hangersPerStringer = Math.max(2, ceilCount(cross / input.hangerSpacing));
  const reserveFactor = 1 + input.reserve / 100;
  function linear(netLength, basePieces, stockLength) {
    const orderPieces = ceilCount(basePieces * reserveFactor);
    return { netLength: round(netLength), orderLength: round(netLength * reserveFactor), basePieces,
      orderPieces, stockLength, purchasedLength: round(orderPieces * stockLength) };
  }
  function pieces(netPieces) { return { netPieces, orderPieces: ceilCount(netPieces * reserveFactor) }; }
  const perimeter = 2 * (length + width);
  const slats = linear(slatRows * run, slatRows * ceilCount(run / input.slatStock), input.slatStock);
  const stringers = linear(stringerRows * cross, stringerRows * ceilCount(cross / input.stringerStock), input.stringerStock);
  const wallAngle = linear(perimeter, 2 * ceilCount(length / input.angleStock) + 2 * ceilCount(width / input.angleStock), input.angleStock);
  const hangers = pieces(stringerRows * hangersPerStringer);
  const wallFixings = pieces(2 * (ceilCount(length / input.fixingSpacing) + 1) + 2 * (ceilCount(width / input.fixingSpacing) + 1));
  return {
    input,
    geometry: { length: round(length), width: round(width), area: round(length * width), perimeter: round(perimeter), run: round(run), cross: round(cross), estimated: input.mode === 'area' },
    layout: { pitchMm, slatRows, edgeMargin: round(Math.max(0, (cross - occupied) / 2)),
      stringerRows, actualStringerSpacing: round(run / stringerRows), hangersPerStringer,
      actualHangerSpacing: round(cross / hangersPerStringer) },
    coefficients: { slatsPerSquareMeter: round(1000 / pitchMm), stringersPerSquareMeter: round(1 / input.stringerSpacing), hangersPerSquareMeter: round(1 / (input.stringerSpacing * input.hangerSpacing)) },
    materials: { slats, stringers, wallAngle, hangers, wallFixings },
  };
}
