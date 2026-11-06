import { describe, expect, it } from 'vitest';
import { formatInput, formatLength, fromMm, parseLength, toMm } from '../src/model/units.js';

describe('conversion', () => {
    it('converts to and from millimetres', () => {
        expect(toMm(1, 'in')).toBe(25.4);
        expect(toMm(2, 'ft')).toBeCloseTo(609.6);
        expect(toMm(1.5, 'm')).toBe(1500);
        expect(fromMm(254, 'cm')).toBe(25.4);
    });

    it('rejects unknown units', () => {
        expect(() => toMm(1, 'yd')).toThrow('Unknown unit');
    });
});

describe('formatLength', () => {
    it('formats metric with a suffix and trimmed decimals', () => {
        expect(formatLength(450, 'mm')).toBe('450 mm');
        expect(formatLength(19.05, 'mm')).toBe('19.1 mm');
        expect(formatLength(609.6, 'cm')).toBe('60.96 cm');
        expect(formatLength(609.6, 'm')).toBe('0.61 m');
    });

    it('is not thrown off by float noise from conversions', () => {
        expect(formatLength(toMm(0.75, 'in'), 'mm')).toBe('19.1 mm'); // 19.049999999999997
        expect(formatInput(toMm(0.75, 'in'), 'mm')).toBe('19.1');
        expect(formatLength(-toMm(0.75, 'in'), 'mm')).toBe('-19.1 mm');
        expect(formatLength(0, 'cm')).toBe('0 cm');
    });

    it('formats inches as reduced fractions to 1/16', () => {
        expect(formatLength(toMm(0.75, 'in'), 'in')).toBe('3/4"');
        expect(formatLength(toMm(22.5, 'in'), 'in')).toBe('22 1/2"');
        expect(formatLength(toMm(24, 'in'), 'in')).toBe('24"');
        expect(formatLength(toMm(1 + 3 / 16, 'in'), 'in')).toBe('1 3/16"');
    });

    it('rounds to the nearest 1/16', () => {
        expect(formatLength(18, 'in')).toBe('11/16"'); // 0.7087"
        expect(formatLength(toMm(0.99, 'in'), 'in')).toBe('1"');
    });

    it('supports a finer precision', () => {
        expect(formatLength(toMm(1 / 32, 'in'), 'in', 32)).toBe('1/32"');
    });

    it('formats feet and inches', () => {
        expect(formatLength(toMm(23.25, 'in'), 'ft')).toBe('1\' 11 1/4"');
        expect(formatLength(toMm(24, 'in'), 'ft')).toBe('2\' 0"');
        expect(formatLength(toMm(6.5, 'in'), 'ft')).toBe('6 1/2"');
    });

    it('carries rounded inches into feet', () => {
        expect(formatLength(toMm(11.999, 'in'), 'ft')).toBe('1\' 0"');
    });

    it('keeps the sign of negative values', () => {
        expect(formatLength(toMm(-1.5, 'in'), 'in')).toBe('-1 1/2"');
        expect(formatLength(-20, 'mm')).toBe('-20 mm');
    });
});

describe('formatInput', () => {
    it('drops the metric suffix so the value can be edited', () => {
        expect(formatInput(450, 'mm')).toBe('450');
        expect(formatInput(609.6, 'm')).toBe('0.61');
    });

    it('keeps imperial marks', () => {
        expect(formatInput(toMm(1.5, 'in'), 'in')).toBe('1 1/2"');
    });
});

describe('parseLength', () => {
    it('reads bare numbers in the current unit', () => {
        expect(parseLength('450', 'mm')).toBe(450);
        expect(parseLength('1.5', 'ft')).toBeCloseTo(457.2);
        expect(parseLength('.5', 'in')).toBeCloseTo(12.7);
    });

    it('reads fractions and mixed numbers', () => {
        expect(parseLength('3/4', 'in')).toBeCloseTo(19.05);
        expect(parseLength('1 1/2', 'in')).toBeCloseTo(38.1);
        expect(parseLength('1-1/2', 'in')).toBeCloseTo(38.1);
    });

    it('lets marks and suffixes override the current unit', () => {
        expect(parseLength('1\' 6 1/2"', 'mm')).toBeCloseTo(469.9);
        expect(parseLength('2ft', 'mm')).toBeCloseTo(609.6);
        expect(parseLength('6"', 'm')).toBeCloseTo(152.4);
        expect(parseLength('45 cm', 'in')).toBe(450);
        expect(parseLength('0.3m', 'in')).toBe(300);
    });

    it('reads negative values', () => {
        expect(parseLength('-3/4', 'in')).toBeCloseTo(-19.05);
    });

    it('round-trips formatted values', () => {
        for (const unit of ['mm', 'cm', 'm', 'in', 'ft']) {
            const mm = toMm(23.25, 'in');
            expect(parseLength(formatInput(mm, unit), unit)).toBeCloseTo(mm, 0);
        }
    });

    it('returns NaN for text it cannot read', () => {
        for (const text of ['', 'abc', '1 2', '3/0', '1/2/3', '"']) {
            expect(parseLength(text, 'in')).toBeNaN();
        }
    });
});
