// Linear INPUTS are millimetres. Geometry uses metres for 3D; take-off uses
// commercial linear metres. Area estimates do not inherit a fictitious square's
// row count, cutting waste or perimeter. Spacings are project assumptions.
export const DEFAULTS = Object.freeze({
  mode: 'dimensions', length: 5000, width: 4000, area: 20,
  slatWidth: 50, slatHeight: 100, gap: 50, orientation: 'length',
  stringerSpacing: 1000, hangerSpacing: 600,
  reserve: 5, slatStock: 3000, stringerStock: 3000, color: '9006',
  connectorMode: 'auto', connectorRun: '', connectorQuantity: '',
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
  length: [200, 100000, 'Длина помещения, мм'], width: [200, 100000, 'Ширина помещения, мм'],
  area: [0.04, 10000, 'Площадь, м²'],
  slatWidth: [20, 200, 'Ширина рейки, мм'], slatHeight: [20, 200, 'Высота рейки, мм'],
  gap: [0, 200, 'Зазор, мм'], stringerSpacing: [200, 2000, 'Шаг гребёнок, мм'],
  hangerSpacing: [150, 1200, 'Шаг подвесов, мм'], reserve: [0, 30, 'Запас, %'],
  slatStock: [1000, 6000, 'Длина заготовки рейки, мм'],
  stringerStock: [1000, 6000, 'Длина заготовки гребёнки, мм'],
  connectorRun: [200, 100000, 'Длина линии рейки, мм'],
  connectorQuantity: [0, 10000000, 'Количество соединителей, шт.'],
};
function number(input, field) {
  const [min, max, label] = limits[field], value = decimal(input[field]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new CalculatorInputError(field, `${label}: введите число от ${min} до ${max}.`);
  }
  return value;
}
export const ceilCount = value => Math.ceil(value - 1e-9);
export const floorCount = value => Math.floor(value + 1e-9);
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export function calculateCeiling(values = {}) {
  const raw = { ...DEFAULTS, ...values };
  if (!['dimensions', 'area'].includes(raw.mode)) throw new CalculatorInputError('mode', 'Неизвестный режим расчёта.');
  if (!['length', 'width'].includes(raw.orientation)) throw new CalculatorInputError('orientation', 'Выберите направление реек.');
  if (!['auto', 'project'].includes(raw.connectorMode)) throw new CalculatorInputError('connectorMode', 'Выберите способ подбора соединителей.');
  const input = { mode: raw.mode, orientation: raw.orientation, color: String(raw.color), connectorMode: raw.connectorMode };
  for (const field of ['slatWidth', 'slatHeight', 'gap', 'stringerSpacing', 'hangerSpacing', 'reserve', 'slatStock', 'stringerStock']) input[field] = number(raw, field);
  // The conditional square is solely a visual example in area mode.
  let length, width;
  if (raw.mode === 'area') {
    input.area = number(raw, 'area'); length = width = Math.sqrt(input.area);
  } else {
    input.length = number(raw, 'length'); input.width = number(raw, 'width');
    length = input.length / 1000; width = input.width / 1000; input.area = length * width;
  }
  const run = input.orientation === 'length' ? length : width;
  const cross = input.orientation === 'length' ? width : length;
  const pitchMm = input.slatWidth + input.gap;
  const slatRows = Math.max(1, floorCount((cross * 1000 + input.gap) / pitchMm));
  const occupied = (slatRows * input.slatWidth + (slatRows - 1) * input.gap) / 1000;
  const stringerRows = Math.max(2, ceilCount(run * 1000 / input.stringerSpacing));
  const hangersPerStringer = Math.max(2, ceilCount(cross * 1000 / input.hangerSpacing));
  const reserveFactor = 1 + input.reserve / 100;
  function linear(netLength, basePieces, stockMm) {
    const orderPieces = ceilCount(basePieces * reserveFactor);
    return { netLength: round(netLength), orderLength: round(netLength * reserveFactor), basePieces,
      orderPieces, stockMm, purchasedLength: round(orderPieces * stockMm / 1000) };
  }
  let slats, stringers, hangers;
  if (input.mode === 'area') {
    const slatMetres = input.area * 1000 / pitchMm;
    const carrierMetres = input.area * 1000 / input.stringerSpacing;
    slats = linear(slatMetres, ceilCount(slatMetres * 1000 / input.slatStock), input.slatStock);
    stringers = linear(carrierMetres, ceilCount(carrierMetres * 1000 / input.stringerStock), input.stringerStock);
    // Purchase allowance for hangers on each carrier blank, including spare
    // blanks. The reserve is already included; it must not be applied twice.
    const perBlank = ceilCount(input.stringerStock / input.hangerSpacing);
    hangers = { netPieces: stringers.basePieces * perBlank, orderPieces: stringers.orderPieces * perBlank, perBlank, basis: 'blanks' };
  } else {
    slats = linear(slatRows * run, slatRows * ceilCount(run * 1000 / input.slatStock), input.slatStock);
    stringers = linear(stringerRows * cross, stringerRows * ceilCount(cross * 1000 / input.stringerStock), input.stringerStock);
    const netPieces = stringerRows * hangersPerStringer;
    hangers = { netPieces, orderPieces: ceilCount(netPieces * reserveFactor), basis: 'layout' };
  }
  let connectors;
  if (input.connectorMode === 'project') {
    input.connectorQuantity = number(raw, 'connectorQuantity');
    if (!Number.isInteger(input.connectorQuantity)) throw new CalculatorInputError('connectorQuantity', 'Соединители: введите целое количество, уже с запасом.');
    connectors = { netPieces: null, orderPieces: input.connectorQuantity, basis: 'project', pending: false };
  } else {
    const hasRun = raw.connectorRun !== '' && raw.connectorRun != null;
    if (input.mode === 'area' && !hasRun) connectors = { netPieces: null, orderPieces: null, basis: 'unknown', pending: true };
    else {
      const runMm = input.mode === 'dimensions' ? run * 1000 : number(raw, 'connectorRun');
      if (input.mode === 'area') input.connectorRun = runMm;
      const rows = input.mode === 'dimensions' ? slatRows : ceilCount(slats.netLength * 1000 / runMm);
      const jointsPerRow = Math.max(0, ceilCount(runMm / input.slatStock) - 1);
      const netPieces = rows * jointsPerRow;
      connectors = { netPieces, orderPieces: ceilCount(netPieces * reserveFactor), basis: 'joints', pending: false,
        estimated: input.mode === 'area', rows, jointsPerRow, runMm };
    }
  }
  return { input,
    geometry: { length: round(length), width: round(width), area: round(input.area), perimeter: round(2 * (length + width)), run: round(run), cross: round(cross), estimated: input.mode === 'area' },
    layout: { pitchMm, slatRows, edgeMargin: round(Math.max(0, (cross - occupied) / 2)), stringerRows,
      actualStringerSpacing: round(run * 1000 / stringerRows), hangersPerStringer, actualHangerSpacing: round(cross * 1000 / hangersPerStringer) },
    coefficients: { slatsPerSquareMeter: round(1000 / pitchMm), stringersPerSquareMeter: round(1000 / input.stringerSpacing) },
    materials: { slats, stringers, hangers, connectors },
  };
}
