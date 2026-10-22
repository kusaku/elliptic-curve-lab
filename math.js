/* Exact finite-field arithmetic for the small primes used by the explorer. */
(() => {
    'use strict';
    const mod = (value, p) => ((value % p) + p) % p;
    const equal = (P, Q) => P === null || Q === null ? P === Q : P.x === Q.x && P.y === Q.y;
    const formatPoint = P => P === null ? 'O' : `(${P.x}, ${P.y})`;

    function integer(value, name, min = -1_000_000_000, max = 1_000_000_000) {
        if (!/^[+-]?\d+$/.test(String(value).trim())) throw new Error(`${name} must be a whole number.`);
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < min || number > max) {
            throw new Error(`${name} must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`);
        }
        return number;
    }

    function isPrime(p) {
        if (!Number.isInteger(p) || p < 2) return false;
        for (let divisor = 2; divisor * divisor <= p; divisor++) if (p % divisor === 0) return false;
        return true;
    }

    function inverse(value, p) {
        let remainder = p, nextRemainder = mod(value, p), coefficient = 0, nextCoefficient = 1;
        while (nextRemainder !== 0) {
            const quotient = Math.floor(remainder / nextRemainder);
            [remainder, nextRemainder] = [nextRemainder, remainder - quotient * nextRemainder];
            [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
        }
        if (remainder !== 1) throw new Error('This value has no multiplicative inverse in the chosen field.');
        return mod(coefficient, p);
    }

    function createCurve(a, b, p) {
        p = integer(p, 'p', 5, 997);
        if (!isPrime(p)) throw new Error('p must be prime. Try 17, 23, 97, or 997.');
        a = mod(integer(a, 'a'), p);
        b = mod(integer(b, 'b'), p);
        if (mod(4 * a ** 3 + 27 * b ** 2, p) === 0) {
            throw new Error('This curve is singular: (4a³ + 27b²) mod p = 0. Choose different a or b.');
        }
        return { a, b, p };
    }

    function onCurve(P, { a, b, p }) {
        return P === null || (Number.isInteger(P.x) && Number.isInteger(P.y) &&
            P.x >= 0 && P.x < p && P.y >= 0 && P.y < p &&
            mod(P.y ** 2, p) === mod(P.x ** 3 + a * P.x + b, p));
    }

    function enumeratePoints({ a, b, p }) {
        const roots = new Map();
        for (let y = 0; y < p; y++) {
            const square = mod(y * y, p);
            if (!roots.has(square)) roots.set(square, []);
            roots.get(square).push(y);
        }
        const points = [];
        for (let x = 0; x < p; x++) {
            for (const y of roots.get(mod(x ** 3 + a * x + b, p)) || []) points.push({ x, y });
        }
        return points;
    }

    function add(P, Q, { a, p }) {
        if (P === null || Q === null) return { kind: 'identity', P, Q, result: P === null ? Q : P };
        if (P.x === Q.x && mod(P.y + Q.y, p) === 0) return { kind: 'inverse', P, Q, result: null };
        const kind = equal(P, Q) ? 'double' : 'add';
        const numerator = kind === 'double' ? 3 * P.x ** 2 + a : Q.y - P.y;
        const denominator = kind === 'double' ? 2 * P.y : Q.x - P.x;
        const numMod = mod(numerator, p), denMod = mod(denominator, p);
        const inv = inverse(denMod, p), slope = mod(numMod * inv, p);
        const xRaw = slope ** 2 - P.x - Q.x;
        const x = mod(xRaw, p), yRaw = slope * (P.x - x) - P.y;
        const result = { x, y: mod(yRaw, p) };
        return { kind, P, Q, result, numerator, denominator, numMod, denMod, inv, slope, xRaw, yRaw,
            third: { x, y: mod(-result.y, p) } };
    }

    function pointOrder(G, curve, groupOrder) {
        let P = null;
        for (let n = 1; n <= groupOrder; n++) {
            P = add(P, G, curve).result;
            if (P === null) return n;
        }
        throw new Error('Could not determine the order of G.');
    }

    function scalar(value) {
        const text = String(value).trim();
        if (!/^\d{1,78}$/.test(text)) throw new Error('d must be a non-negative whole number with at most 256 bits.');
        const d = BigInt(text);
        if (d >= 2n ** 256n) throw new Error('d must fit in 256 bits.');
        return d;
    }

    function makeTrace(G, d, curve, method) {
        if (method !== 'repeated' && method !== 'binary') throw new Error('Unknown multiplication method.');
        if (method === 'repeated' && d > 512n) throw new Error('Repeated addition is limited to d ≤ 512. Use double-and-add for larger d.');
        const trace = [{ kind: 'start', result: null, scalar: 0n, expression: '0G = O', note: 'Begin with the identity point O.' }];
        let R = null, k = 0n;
        const push = (operand, nextScalar, expression, note) => {
            const step = add(R, operand, curve);
            trace.push({ ...step, scalar: nextScalar, expression, note });
            R = step.result;
            k = nextScalar;
        };
        if (method === 'repeated') {
            for (let i = 1n; i <= d; i++) push(G, i, `${i - 1n}G + G = ${i}G`, 'Add the same base point G once more.');
        } else if (d > 0n) {
            const bits = d.toString(2);
            for (let index = 0; index < bits.length; index++) {
                const note = `Read bit ${index + 1} of ${bits.length}: ${bits[index]}.`;
                if (k > 0n) push(R, 2n * k, `${k}G + ${k}G = ${2n * k}G`, `${note} Double the accumulated point.`);
                if (bits[index] === '1') push(G, k + 1n, `${k}G + G = ${k + 1n}G`, `${note} The bit is 1, so add G.`);
            }
        }
        return trace;
    }

    function parseFormula(value) {
        const expression = value.toLowerCase().replace(/²/g, '^2').replace(/³/g, '^3')
            .replace(/−/g, '-').replace(/\*\*/g, '^').replace(/\s|\*/g, '').replace(/^y\^2=/, '');
        const match = /^x\^3(?:([+-]\d*)x)?([+-]\d+)?$/.exec(expression);
        if (!match) throw new Error('Use y^2 = x^3 + 2x + 2, or just x^3 - 3x + 7. Only the coefficients a and b may change.');
        const a = match[1] === '+' ? 1 : match[1] === '-' ? -1 : match[1] || 0;
        return { a: integer(a, 'a'), b: integer(match[2] || 0, 'b') };
    }

    function formula(a, b) {
        const term = (n, suffix) => n === 0 ? '' : ` ${n < 0 ? '−' : '+'} ${Math.abs(n) === 1 && suffix ? '' : Math.abs(n)}${suffix}`;
        return `y² = x³${term(a, 'x')}${term(b, '')}`;
    }

    const API = { mod, equal, formatPoint, integer, isPrime, inverse, createCurve, onCurve, enumeratePoints,
        add, pointOrder, scalar, makeTrace, parseFormula, formula };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else window.ECC = API;
})();
