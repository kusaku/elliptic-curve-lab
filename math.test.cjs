const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./math.js');

const classic = E.createCurve(2, 2, 17);
const G = { x: 5, y: 1 };
const multiples = [null, [5, 1], [6, 3], [10, 6], [3, 1], [9, 16], [16, 13], [0, 6],
    [13, 7], [7, 6], [7, 11], [13, 10], [0, 11], [16, 4], [9, 1], [3, 16], [10, 11], [6, 14], [5, 16], null]
    .map(P => P && { x: P[0], y: P[1] });

test('all 19 known multiples on the default curve, including infinity', () => {
    const trace = E.makeTrace(G, 19n, classic, 'repeated');
    assert.deepEqual(trace.map(step => step.result), multiples);
    assert.equal(E.pointOrder(G, classic, 19), 19);
    assert.equal(E.enumeratePoints(classic).length, 18);
    assert.deepEqual(E.makeTrace(G, 7n, classic, 'binary').at(-1).result, { x: 0, y: 6 });
});

test('the worked doubling example retains exact intermediate values', () => {
    const step = E.add(G, G, classic);
    assert.deepEqual([step.numerator, step.denominator, step.inv, step.slope, step.xRaw, step.yRaw], [77, 2, 9, 13, 159, -14]);
    assert.deepEqual(step.third, { x: 6, y: 14 });
    assert.deepEqual(step.result, { x: 6, y: 3 });
});

test('identity, inverses and order-two points do not attempt division by zero', () => {
    assert.equal(E.add(null, null, classic).result, null);
    assert.deepEqual(E.add(null, G, classic).result, G);
    assert.deepEqual(E.add(G, null, classic).result, G);
    assert.equal(E.add(G, { x: 5, y: 16 }, classic).result, null);
    const orderTwo = E.createCurve(1, 0, 17);
    assert.equal(E.add({ x: 0, y: 0 }, { x: 0, y: 0 }, orderTwo).result, null);
    assert.equal(E.pointOrder({ x: 0, y: 0 }, orderTwo, 16), 2);
});

test('prime, singular-curve, integer, formula and scalar validation', () => {
    for (const p of [4, 9, 15, 21, 999, 1009]) assert.throws(() => E.createCurve(2, 2, p));
    assert.throws(() => E.createCurve(-3, 2, 17), /singular/);
    assert.throws(() => E.createCurve(0, 0, 17), /singular/);
    assert.deepEqual(E.createCurve(-15, 36, 17), classic);
    assert.deepEqual(E.parseFormula('y² = x³ − 3*x + 7'), { a: -3, b: 7 });
    assert.deepEqual(E.parseFormula('x**3 + x - 1'), { a: 1, b: -1 });
    assert.deepEqual(E.parseFormula('x^3-x'), { a: -1, b: 0 });
    for (const expression of ['x^3+x^2+2', 'alert(1)', 'x^3 + 0.5x', 'x^3;document.body.remove()', 'y^2=x^3+ax+b']) {
        assert.throws(() => E.parseFormula(expression));
    }
    for (const value of ['1.5', '1e3', '-1', '', 'Infinity']) assert.throws(() => E.scalar(value));
    assert.throws(() => E.scalar((2n ** 256n).toString()));
    assert.throws(() => E.makeTrace(G, 513n, classic, 'repeated'));
    assert.equal(E.onCurve({ x: 5, y: 18 }, classic), false);
    assert.equal(E.onCurve({ x: 6, y: 4 }, classic), false);
});

test('point enumeration matches independent brute force', () => {
    for (const [a, b, p] of [[2, 2, 17], [2, 3, 97], [0, 7, 223], [1, 0, 5]]) {
        const curve = E.createCurve(a, b, p), expected = [];
        for (let x = 0; x < p; x++) for (let y = 0; y < p; y++) {
            if ((y * y - x ** 3 - a * x - b) % p === 0) expected.push({ x, y });
        }
        assert.deepEqual(E.enumeratePoints(curve), expected);
    }
});

test('group closure, inverse and commutativity on every small nonsingular curve', () => {
    for (const p of [5, 7, 11]) for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
        if (E.mod(4 * a ** 3 + 27 * b ** 2, p) === 0) continue;
        const curve = E.createCurve(a, b, p), points = [null, ...E.enumeratePoints(curve)];
        for (const P of points) {
            assert(E.equal(E.add(P, null, curve).result, P));
            assert.equal(E.add(P, P && { x: P.x, y: E.mod(-P.y, p) }, curve).result, null);
            for (const Q of points) {
                const R = E.add(P, Q, curve).result;
                assert(E.onCurve(R, curve));
                assert(E.equal(R, E.add(Q, P, curve).result));
            }
        }
    }
});

test('associativity on every triple of points on the default curve', () => {
    const points = [null, ...E.enumeratePoints(classic)];
    for (const P of points) for (const Q of points) for (const R of points) {
        assert(E.equal(E.add(E.add(P, Q, classic).result, R, classic).result,
            E.add(P, E.add(Q, R, classic).result, classic).result));
    }
});

test('binary multiplication agrees with repeated addition across subgroups', () => {
    for (const [a, b, p] of [[2, 2, 17], [2, 3, 97], [0, 7, 223], [1, 0, 17]]) {
        const curve = E.createCurve(a, b, p), points = E.enumeratePoints(curve);
        for (const base of points) {
            const order = E.pointOrder(base, curve, points.length + 1);
            assert.equal((points.length + 1) % order, 0);
            for (const d of [0n, 1n, 2n, 7n, 19n, 31n, 64n]) {
                assert(E.equal(E.makeTrace(base, d, curve, 'binary').at(-1).result,
                    E.makeTrace(base, d, curve, 'repeated').at(-1).result));
            }
        }
    }
});

test('large scalars preserve exact low bits and wrap by n rather than p', () => {
    const curve = E.createCurve(2, 3, 97), base = { x: 3, y: 6 };
    assert.equal(E.pointOrder(base, curve, E.enumeratePoints(curve).length + 1), 5);
    for (const d of [2n ** 128n + 13n, 2n ** 255n, 2n ** 256n - 1n]) {
        const trace = E.makeTrace(base, E.scalar(d.toString()), curve, 'binary');
        assert.equal(trace.at(-1).scalar, d);
        assert(E.equal(trace.at(-1).result, E.makeTrace(base, d % 5n, curve, 'repeated').at(-1).result));
        assert(trace.length <= 513);
    }
});

test('all inverses for all supported primes are exact', () => {
    for (let p = 5; p <= 997; p++) if (E.isPrime(p)) {
        for (let n = 1; n < p; n++) assert.equal(n * E.inverse(n, p) % p, 1);
    }
    assert.throws(() => E.inverse(0, 17));
});
