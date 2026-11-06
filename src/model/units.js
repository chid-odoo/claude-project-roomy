// All lengths are stored in millimetres. Conversion and formatting to the
// unit the user picked only happens at the edges (inputs, labels, cut list).

export const UNITS = {
    mm: { label: 'Millimetres (mm)', mmPer: 1, decimals: 1 },
    cm: { label: 'Centimetres (cm)', mmPer: 10, decimals: 2 },
    m: { label: 'Metres (m)', mmPer: 1000, decimals: 3 },
    in: { label: 'Inches (in)', mmPer: 25.4, imperial: true },
    ft: { label: 'Feet & inches', mmPer: 304.8, imperial: true },
};

export const DEFAULT_PRECISION = 16; // imperial values round to 1/16"

export const THICKNESS_PRESETS = [
    { label: '1/4"', mm: 6.35 },
    { label: '1/2"', mm: 12.7 },
    { label: '3/4"', mm: 19.05 },
    { label: '6 mm', mm: 6 },
    { label: '12 mm', mm: 12 },
    { label: '18 mm', mm: 18 },
];

// How far one arrow-key press moves the selection. The first entry flagged
// `default` is used when the unit system changes.
export const MOVE_STEPS = {
    imperial: [
        { label: '1/16"', mm: 1.5875 },
        { label: '1/4"', mm: 6.35, default: true },
        { label: '1"', mm: 25.4 },
        { label: '1\'', mm: 304.8 },
    ],
    metric: [
        { label: '1 mm', mm: 1 },
        { label: '1 cm', mm: 10, default: true },
        { label: '10 cm', mm: 100 },
    ],
};

export function moveSteps(unit) {
    return MOVE_STEPS[getUnit(unit).imperial ? 'imperial' : 'metric'];
}

function getUnit(unit) {
    const def = UNITS[unit];
    if (!def) {
        throw new Error(`Unknown unit: ${unit}`);
    }
    return def;
}

export function toMm(value, unit) {
    return value * getUnit(unit).mmPer;
}

export function fromMm(mm, unit) {
    return mm / getUnit(unit).mmPer;
}

// Round half away from zero, nudged so float noise like 19.049999999999997
// (3/4" in mm) rounds as the 19.05 it stands for.
function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-6)) / factor;
}

function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
}

// 23.25 -> '23 1/4', 0.75 -> '3/4', 2 -> '2'
function formatInches(inches, precision) {
    const sign = inches < 0 ? '-' : '';
    const parts = Math.round(Math.abs(inches) * precision);
    const whole = Math.floor(parts / precision);
    const rest = parts % precision;
    if (!rest) {
        return `${sign}${whole}`;
    }
    const div = gcd(rest, precision);
    const fraction = `${rest / div}/${precision / div}`;
    return whole ? `${sign}${whole} ${fraction}` : `${sign}${fraction}`;
}

export function formatLength(mm, unit, precision = DEFAULT_PRECISION) {
    const def = getUnit(unit);
    if (unit === 'in') {
        return `${formatInches(mm / def.mmPer, precision)}"`;
    }
    if (unit === 'ft') {
        // Round once on the whole value so 11 15.99/16" carries into feet.
        const sign = mm < 0 ? '-' : '';
        const parts = Math.round((Math.abs(mm) / UNITS.in.mmPer) * precision);
        const feet = Math.floor(parts / (12 * precision));
        const inches = (parts - feet * 12 * precision) / precision;
        if (!feet) {
            return `${sign}${formatInches(inches, precision)}"`;
        }
        return `${sign}${feet}' ${formatInches(inches, precision)}"`;
    }
    return `${roundTo(mm / def.mmPer, def.decimals)} ${unit}`;
}

// Plain text for an input field: no unit suffix for metric, so the field can
// be edited and parsed back with parseLength.
export function formatInput(mm, unit, precision = DEFAULT_PRECISION) {
    if (UNITS[unit].imperial) {
        return formatLength(mm, unit, precision);
    }
    return String(roundTo(mm / UNITS[unit].mmPer, UNITS[unit].decimals));
}

const NUMBER = String.raw`\d+(?:\.\d+)?|\.\d+`;
const MIXED = new RegExp(String.raw`^(${NUMBER})?(?:\s*(?:\s|-)?\s*(\d+)\s*/\s*(\d+))?$`);

// '1 1/2', '3/4', '2.5', '1-1/2' -> number, or NaN
function parseMixed(text) {
    const match = MIXED.exec(text.trim());
    if (!match || (match[1] === undefined && match[2] === undefined)) {
        return NaN;
    }
    let value = match[1] !== undefined ? parseFloat(match[1]) : 0;
    if (match[2] !== undefined) {
        const den = parseInt(match[3], 10);
        if (!den) {
            return NaN;
        }
        value += parseInt(match[2], 10) / den;
    }
    return value;
}

// Parse what a user typed into a length field. A bare number is read in
// `unit`; feet (') and inch (") marks and metric suffixes override it, so
// "1' 6 1/2"" or "450 mm" work whatever unit is selected.
// Returns millimetres, or NaN when the text cannot be read.
export function parseLength(text, unit) {
    let str = String(text).trim().toLowerCase();
    if (!str) {
        return NaN;
    }
    let sign = 1;
    if (str.startsWith('-')) {
        sign = -1;
        str = str.slice(1).trim();
    }

    const metric = /^(.*?)\s*(mm|cm|m)$/.exec(str);
    if (metric) {
        return sign * toMm(parseMixed(metric[1]), metric[2]);
    }

    const imperial = /^(?:(.+?)\s*(?:'|ft))?\s*(?:(.+?)\s*(?:"|in))?$/.exec(str);
    if (imperial && (imperial[1] !== undefined || imperial[2] !== undefined)) {
        const feet = imperial[1] !== undefined ? parseMixed(imperial[1]) : 0;
        const inches = imperial[2] !== undefined ? parseMixed(imperial[2]) : 0;
        return sign * (feet * UNITS.ft.mmPer + inches * UNITS.in.mmPer);
    }

    // "1 6" in feet mode is ambiguous; only accept a single mixed number.
    return sign * toMm(parseMixed(str), unit);
}
