(() => {
    'use strict';
    const { mod, equal, formatPoint: point, integer, createCurve, onCurve, enumeratePoints,
        add, pointOrder, scalar, makeTrace, parseFormula, formula } = window.ECC;
    const $ = id => document.getElementById(id);
    const form = $('parameters');
    const inputs = { a: $('coefficient-a'), b: $('coefficient-b'), p: $('prime'), gx: $('base-x'), gy: $('base-y'), d: $('scalar') };
    const presets = {
        classic: { a: 2, b: 2, p: 17, gx: 5, gy: 1, d: '7', method: 'repeated' },
        subgroup: { a: 2, b: 3, p: 97, gx: 3, gy: 6, d: '7', method: 'repeated' },
        infinity: { a: 2, b: 2, p: 17, gx: 5, gy: 1, d: '19', method: 'repeated' },
        'order-two': { a: 1, b: 0, p: 17, gx: 0, gy: 0, d: '2', method: 'repeated' },
        larger: { a: 0, b: 7, p: 223, gx: 47, gy: 71, d: '11', method: 'repeated' }
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let model = null, index = 0, playing = false, frame = 0, timer = 0, animation = null;
    let equationEdited = false;
    const formulaExplanations = new Map();
    let activeFormulaHelp = null, formulaHelpPinned = false;

    const signed = value => String(value).replace('-', '−');

    function modularBreakdown(value, residue, p) {
        const quotient = (value - residue) / p;
        return `<code>${signed(value)} = ${signed(quotient)} · ${p} + ${residue}</code>, so the remainder is <strong>${residue}</strong>.`;
    }

    function explained(key, label, title, body) {
        formulaExplanations.set(key, { title, body });
        return `<button type="button" class="formula-help-trigger" data-formula-help="${key}" aria-expanded="false">${label}<span class="formula-help-mark" aria-hidden="true">?</span></button>`;
    }

    function hideFormulaHelp() {
        if (activeFormulaHelp) {
            activeFormulaHelp.setAttribute('aria-expanded', 'false');
            activeFormulaHelp.removeAttribute('aria-describedby');
        }
        activeFormulaHelp = null;
        formulaHelpPinned = false;
        $('formula-tooltip').hidden = true;
        $('formula-tooltip').classList.remove('is-pinned');
    }

    function positionFormulaHelp() {
        if (!activeFormulaHelp || $('formula-tooltip').hidden) return;
        const tooltip = $('formula-tooltip'), target = activeFormulaHelp.getBoundingClientRect();
        const gap = 10, margin = 8, width = tooltip.offsetWidth, height = tooltip.offsetHeight;
        let left = target.left + target.width / 2 - width / 2;
        left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
        let top = target.top - height - gap, placement = 'above';
        if (top < margin) { top = Math.min(window.innerHeight - height - margin, target.bottom + gap); placement = 'below'; }
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(margin, top)}px`;
        tooltip.style.setProperty('--tooltip-arrow-left', `${Math.max(14, Math.min(width - 20, target.left + target.width / 2 - left - 5))}px`);
        tooltip.dataset.placement = placement;
    }

    function showFormulaHelp(trigger, pinned = false) {
        const content = formulaExplanations.get(trigger.dataset.formulaHelp);
        if (!content) return;
        if (activeFormulaHelp && activeFormulaHelp !== trigger) {
            activeFormulaHelp.setAttribute('aria-expanded', 'false');
            activeFormulaHelp.removeAttribute('aria-describedby');
        }
        activeFormulaHelp = trigger;
        formulaHelpPinned = pinned;
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-describedby', 'formula-tooltip');
        $('formula-tooltip-title').textContent = content.title;
        $('formula-tooltip-body').innerHTML = content.body;
        $('formula-tooltip').hidden = false;
        $('formula-tooltip').classList.toggle('is-pinned', pinned);
        positionFormulaHelp();
    }

    function setError(message) {
        $('parameter-error').textContent = message;
        $('parameter-error').hidden = !message;
    }

    function syncEquation() {
        try { $('formula').value = formula(integer(inputs.a.value, 'a'), integer(inputs.b.value, 'b')).replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-'); }
        catch { /* Incomplete input is validated when the experiment is built. */ }
    }

    function readCurve() {
        if (equationEdited) {
            const coefficients = parseFormula($('formula').value);
            inputs.a.value = coefficients.a;
            inputs.b.value = coefficients.b;
        }
        return createCurve(inputs.a.value, inputs.b.value, inputs.p.value);
    }

    function build() {
        stop();
        try {
            const curve = readCurve();
            const G = { x: integer(inputs.gx.value, 'G.x', 0, curve.p - 1), y: integer(inputs.gy.value, 'G.y', 0, curve.p - 1) };
            if (!onCurve(G, curve)) throw new Error(`G = ${point(G)} is not on this curve. Edit its coordinates or use Find a point.`);
            const d = scalar(inputs.d.value);
            let method = $('method').value;
            let notice = '';
            if (method === 'repeated' && d > 512n) {
                method = 'binary';
                notice = 'Switched to double-and-add because d is greater than 512.';
            }
            const points = enumeratePoints(curve), order = pointOrder(G, curve, points.length + 1);
            const trace = makeTrace(G, d, curve, method);
            model = { curve, G, d, points, order, trace, method, Q: trace.at(-1).result };
            index = 0;
            $('method').value = method;
            $('parameter-notice').textContent = notice;
            setError('');
            equationEdited = false;
            syncEquation();
            renderExperiment();
            return true;
        } catch (error) {
            setError(error.message);
            $('parameter-notice').textContent = model ? 'The plot still shows the last valid experiment.' : '';
            return false;
        }
    }

    function loadPreset(name) {
        const preset = presets[name];
        for (const [key, field] of Object.entries(inputs)) field.value = preset[key];
        $('method').value = preset.method;
        equationEdited = false;
        syncEquation();
        build();
    }

    function renderExperiment() {
        const { curve, G, d, points, order, Q, method, trace } = model;
        $('curve-equation').innerHTML = `${formula(curve.a, curve.b)} <span>mod ${curve.p}</span>`;
        $('wrap-value').textContent = curve.p;
        $('group-order').textContent = points.length + 1;
        $('group-order').title = `${points.length} coordinate points plus the identity O`;
        $('point-order').textContent = order;
        $('private-value').textContent = `d = ${d}`;
        $('base-value').textContent = `G = ${point(G)}`;
        $('public-value').textContent = `Q = ${point(Q)}`;
        const warning = $('scalar-warning');
        warning.hidden = d > 0n && d < BigInt(order);
        warning.textContent = d === 0n || d % BigInt(order) === 0n
            ? 'Q = O. This is a valid group result, but O cannot be used as a real public key.'
            : `Scalars repeat every ${order}: ${d}G = ${d % BigInt(order)}G. A real private scalar is chosen between 1 and n − 1.`;
        $('step-slider').max = trace.length - 1;
        const binary = d.toString(2);
        $('method-summary').textContent = method === 'repeated'
            ? `${trace.length - 1} additions · add G at each step`
            : `${trace.length - 1} operations · ${binary.length > 32 ? `${binary.length} bits` : `d = ${binary}₂`}`;
        $('trace-list').innerHTML = trace.map((step, i) => `<button type="button" class="trace-step" data-step="${i}" aria-label="Step ${i}: ${step.expression}; result ${point(step.result)}"><span class="trace-index">${i.toString().padStart(2, '0')}</span><span class="trace-expression">${step.expression}</span><span class="trace-result">${point(step.result)}</span></button>`).join('');
        renderStep();
    }

    function calculationLine(title, content) {
        return `<div class="calculation-line"><div class="line-title">${title}</div><code>${content}</code></div>`;
    }

    function renderCalculation() {
        const step = model.trace[index], { curve, G } = model;
        const names = { start: 'START AT O', identity: 'IDENTITY · O + P = P', double: 'POINT DOUBLING', add: 'POINT ADDITION', inverse: 'RETURN TO INFINITY' };
        $('step-kind').textContent = names[step.kind];
        const operation = step.kind === 'start' ? step.expression : explained('operation', step.expression, 'What this scalar step means', `<p><strong>${step.expression}</strong> describes scalar multiples of G, not coordinate-by-coordinate multiplication.</p><p class="value-map"><strong>P = ${point(step.P)}</strong> is the accumulated point before this step. <strong>B = ${point(step.Q)}</strong> is the point being added. The formulas below calculate their group sum.</p>`);
        let html = `<p class="operation-equation">${operation}</p><p class="operation-note">${step.note}</p>`;
        if (step.kind === 'start') {
            html += `<div class="start-illustration">O <span>the identity point</span></div><p class="operation-note">Begin at 0G = O. The first addition takes you to G = ${point(G)}. Use Next or Play to see the arithmetic.</p>`;
            if (model.d === 0n) html += '<div class="result-check">d = 0, so no additions are needed. Q = O.</div>';
            $('calculation').innerHTML = html;
            return;
        }
        html += calculationLine('Inputs', explained('inputs', `P = ${point(step.P)}<br>B = ${point(step.Q)}`, 'Where P and B come from', `<p><strong>P</strong> is the result accumulated by earlier scalar steps. Its coordinates supply <code>x₁ = ${step.P?.x ?? 'O'}</code> and <code>y₁ = ${step.P?.y ?? 'O'}</code>.</p><p><strong>B</strong> is this operation’s second operand. Its coordinates supply <code>x₂ = ${step.Q?.x ?? 'O'}</code> and <code>y₂ = ${step.Q?.y ?? 'O'}</code>.</p><p class="value-map">Thus every number used below comes directly from <strong>P = ${point(step.P)}</strong>, <strong>B = ${point(step.Q)}</strong>, or the curve parameters.</p>`));
        if (step.kind === 'identity') {
            html += calculationLine('The identity rule', explained('identity', `${point(step.P)} + ${point(step.Q)} = <span class="result-number">${point(step.result)}</span>`, 'Why adding O changes nothing', `<p><strong>O</strong> is the identity element of the elliptic-curve group, exactly as 0 is the identity for ordinary addition.</p><p>Therefore <code>O + B = B</code> and <code>P + O = P</code>. No slope is needed in this special case.</p>`));
            html += '<p class="operation-note">O acts like zero for point addition. No slope or modular inverse is needed.</p>';
        } else if (step.kind === 'inverse') {
            const ySum = step.P.y + step.Q.y, ySumMod = mod(ySum, curve.p);
            html += calculationLine('A vertical line', explained('inverse', `x₁ = x₂ = ${step.P.x}<br>(y₁ + y₂) mod ${curve.p} = ${ySumMod}<br>P + (−P) = <span class="result-number">O</span>`, 'Why this sum is the point at infinity', `<p>The x coordinates are equal: <code>x₁ = ${step.P.x}</code> from P and <code>x₂ = ${step.Q.x}</code> from B. The y coordinates are opposites modulo ${curve.p}.</p><p><code>${step.P.y} + ${step.Q.y} = ${ySum}</code>, and ${modularBreakdown(ySum, ySumMod, curve.p)}</p><p>The line through inverse points is vertical, so it meets the curve at O. Hence the group sum is <strong>O</strong>.</p>`));
            html += '<p class="operation-note">The points are inverses (or the same point with y = 0). There is no finite slope to divide by, so the sum is O.</p>';
        } else {
            const { P, Q, numerator, denominator, numMod, denMod, inv, slope, xRaw, yRaw, result, third } = step;
            const numeratorFormula = step.kind === 'double' ? `3 · ${P.x}² + ${curve.a}` : `${Q.y} − ${P.y}`;
            const denominatorFormula = step.kind === 'double' ? `2 · ${P.y}` : `${Q.x} − ${P.x}`;
            const numeratorOrigin = step.kind === 'double'
                ? `<p>Because P = B, a secant would give 0/0. We use the tangent slope. For <code>y² = x³ + ax + b</code>, its numerator is <code>3x₁² + a</code>.</p><p class="value-map"><strong>x₁ = ${P.x}</strong> comes from P = ${point(P)} and <strong>a = ${curve.a}</strong> comes from the curve. Substitution gives <code>3 · ${P.x}² + ${curve.a} = ${numerator}</code>.</p>`
                : `<p>The numerator is the vertical change <code>y₂ − y₁</code> between B and P.</p><p class="value-map">P = ${point(P)} gives <strong>y₁ = ${P.y}</strong>. B = ${point(Q)} gives <strong>y₂ = ${Q.y}</strong>. Therefore <code>y₂ − y₁ = ${Q.y} − ${P.y} = ${numerator}</code>.</p>`;
            const denominatorOrigin = step.kind === 'double'
                ? `<p>For a tangent, the denominator is <code>2y₁</code>.</p><p class="value-map">P = ${point(P)} gives <strong>y₁ = ${P.y}</strong>, so <code>2y₁ = 2 · ${P.y} = ${denominator}</code>.</p>`
                : `<p>The denominator is the horizontal change <code>x₂ − x₁</code> between B and P.</p><p class="value-map">P = ${point(P)} gives <strong>x₁ = ${P.x}</strong>. B = ${point(Q)} gives <strong>x₂ = ${Q.x}</strong>. Therefore <code>x₂ − x₁ = ${Q.x} − ${P.x} = ${denominator}</code>.</p>`;
            const ingredients = explained('numerator', `numerator = ${numeratorFormula}<br>= ${numerator} ≡ <span class="accent-number">${numMod}</span> mod ${curve.p}`, 'Where the numerator comes from', `${numeratorOrigin}<p>Reduce it into 0…${curve.p - 1}: ${modularBreakdown(numerator, numMod, curve.p)}</p>`)
                + '<br>' + explained('denominator', `denominator = ${denominatorFormula}<br>= ${denominator} ≡ <span class="accent-number">${denMod}</span> mod ${curve.p}`, 'Where the denominator comes from', `${denominatorOrigin}<p>Reduce it into 0…${curve.p - 1}: ${modularBreakdown(denominator, denMod, curve.p)}</p>`);
            html += calculationLine(step.kind === 'double' ? '1 · Tangent slope ingredients' : '1 · Line slope ingredients', ingredients);
            const inverseProduct = denMod * inv, inverseQuotient = (inverseProduct - 1) / curve.p;
            html += calculationLine('2 · Divide using a modular inverse', `${explained('inverse-value', `${denMod}⁻¹ = <span class="accent-number">${inv}</span>, because<br>${denMod} · ${inv} = ${inverseProduct} ≡ 1 mod ${curve.p}`, 'How the modular inverse was found', `<p>Division is replaced by multiplication by an inverse. We need a number z for which <code>${denMod} · z ≡ 1 (mod ${curve.p})</code>.</p><p>Here z = ${inv}: <code>${denMod} · ${inv} = ${inverseProduct} = ${inverseQuotient} · ${curve.p} + 1</code>. Its remainder is 1, so <strong>${denMod}⁻¹ = ${inv}</strong>.</p>`)}<br>${explained('slope', `λ = ${numMod} · ${inv} mod ${curve.p} = <span class="accent-number">${slope}</span>`, 'How the slope λ was calculated', `<p>The field division <code>${numMod} / ${denMod}</code> means multiplying the numerator by the denominator’s modular inverse.</p><p><code>λ = ${numMod} · ${inv} = ${numMod * inv}</code>. ${modularBreakdown(numMod * inv, slope, curve.p)}</p><p>This λ is used both for the helper line and for the result coordinates.</p>`)}`);
            html += calculationLine('3 · The new x coordinate', explained('x-coordinate', `x₃ = λ² − x₁ − x₂<br>= ${slope}² − ${P.x} − ${Q.x}<br>= ${xRaw} ≡ <span class="result-number">${result.x}</span> mod ${curve.p}`, 'How x₃ was calculated', `<p>Substituting the helper line into the curve gives a cubic with the three intersection x-coordinates. Since x₁ and x₂ are already known, the third one satisfies <code>x₃ = λ² − x₁ − x₂</code>.</p><p class="value-map"><strong>λ = ${slope}</strong>, <strong>x₁ = ${P.x}</strong> from P, and <strong>x₂ = ${Q.x}</strong> from B.</p><p><code>${slope}² − ${P.x} − ${Q.x} = ${xRaw}</code>. ${modularBreakdown(xRaw, result.x, curve.p)}</p>`));
            const lineYRaw = slope * (result.x - P.x) + P.y;
            html += calculationLine('4 · Reflect to get y', `${explained('y-coordinate', `y₃ = λ(x₁ − x₃) − y₁<br>= ${slope}(${P.x} − ${result.x}) − ${P.y}<br>= ${yRaw} ≡ <span class="result-number">${result.y}</span> mod ${curve.p}`, 'How the result y-coordinate was calculated', `<p>The helper line first reaches the third intersection T. Point addition is defined as the reflection of T, so the reflected coordinate is <code>y₃ = λ(x₁ − x₃) − y₁</code>.</p><p class="value-map"><strong>λ = ${slope}</strong>, <strong>x₁ = ${P.x}</strong>, <strong>x₃ = ${result.x}</strong>, and <strong>y₁ = ${P.y}</strong>.</p><p><code>${slope}(${P.x} − ${result.x}) − ${P.y} = ${yRaw}</code>. ${modularBreakdown(yRaw, result.y, curve.p)}</p>`)}<br>${explained('third-point', `T = ${point(third)} → R = −T = ${point(result)}`, 'How T and R were obtained', `<p>T lies on the helper line at the new x-coordinate <code>x₃ = ${result.x}</code>. Put that x into <code>y = λ(x − x₁) + y₁</code>:</p><p><code>yT = ${slope}(${result.x} − ${P.x}) + ${P.y} = ${lineYRaw} ≡ ${third.y} (mod ${curve.p})</code>.</p><p>So <strong>T = ${point(third)}</strong>. Reflect vertically by keeping x and negating y: <code>−${third.y} ≡ ${result.y} (mod ${curve.p})</code>. Therefore <strong>R = −T = ${point(result)}</strong>.</p>`)}`);
        }
        if (step.result === null) html += '<div class="result-check">✓ O belongs to the curve group.</div>';
        else {
            const { x, y } = step.result;
            const lhs = mod(y * y, curve.p), rhs = mod(x ** 3 + curve.a * x + curve.b, curve.p);
            const leftRaw = y * y, rightRaw = x ** 3 + curve.a * x + curve.b;
            html += `<div class="result-check">✓ R = ${point(step.result)} lies on the curve.<code>${explained('curve-check', `y² mod ${curve.p} = ${lhs}<br>(x³ + ${curve.a}x + ${curve.b}) mod ${curve.p} = ${rhs}`, 'How the curve-membership check works', `<p>For R = (${x}, ${y}), substitute x and y into both sides of <code>y² ≡ x³ + ax + b (mod ${curve.p})</code>.</p><p>Left: <code>${y}² = ${leftRaw}</code>, and ${modularBreakdown(leftRaw, lhs, curve.p)}</p><p>Right: <code>${x}³ + ${curve.a}·${x} + ${curve.b} = ${rightRaw}</code>, and ${modularBreakdown(rightRaw, rhs, curve.p)}</p><p>Both remainders are <strong>${lhs}</strong>, so R is on the curve.</p>`)}</code></div>`;
        }
        $('calculation').innerHTML = html;
    }

    function renderStep() {
        hideFormulaHelp();
        formulaExplanations.clear();
        $('step-counter').textContent = `${index} / ${model.trace.length - 1}`;
        $('step-slider').value = index;
        $('step-slider').setAttribute('aria-valuetext', `Step ${index}: ${model.trace[index].expression}`);
        $('first-step').disabled = $('previous-step').disabled = index === 0;
        $('last-step').disabled = $('next-step').disabled = index === model.trace.length - 1;
        $('play').disabled = model.trace.length === 1;
        for (const row of $('trace-list').children) {
            if (Number(row.dataset.step) === index) row.setAttribute('aria-current', 'step');
            else row.removeAttribute('aria-current');
        }
        const row = $('trace-list').children[index], list = $('trace-list');
        if (row) {
            const top = row.offsetTop - list.firstElementChild.offsetTop;
            if (top < list.scrollTop) list.scrollTop = top;
            else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
        }
        renderCalculation();
        renderPlot();
    }

    function renderConstruction(step) {
        const show = $('construction').checked;
        const regular = step.kind === 'add' || step.kind === 'double';
        $('helper-line-key').hidden = !show || !regular;
        $('reflection-key').hidden = !show || !step.third;
        const explanation = $('construction-explanation');
        explanation.hidden = !show;
        if (!show) return;
        const { p } = model.curve;
        if (regular) {
            const reflection = equal(step.third, step.result)
                ? 'Here T = R: reflecting this point leaves it unchanged.'
                : `The purple dashed segment shows <strong>T → R = ${point(step.result)}</strong>: keep x, replace y with −y mod ${p}.`;
            const helperLine = explained('helper-line', `y = ${step.slope}(x − ${step.P.x}) + ${step.P.y} mod ${p}`, 'Where the helper-line equation comes from', `<p>This is point-slope form <code>y = λ(x − x₁) + y₁</code> written in the finite field.</p><p class="value-map"><strong>λ = ${step.slope}</strong> was calculated in the slope panel. P = ${point(step.P)} supplies <strong>x₁ = ${step.P.x}</strong> and <strong>y₁ = ${step.P.y}</strong>.</p><p>At x = ${step.P.x}, the expression becomes <code>${step.slope}(${step.P.x} − ${step.P.x}) + ${step.P.y} = ${step.P.y}</code>, so the line passes through P. Each purple + uses one x from 0 to ${p - 1} and reduces the resulting y modulo ${p}.</p>`);
            const lineYRaw = step.slope * (step.third.x - step.P.x) + step.P.y;
            const thirdHelp = explained('construction-third', `T = ${point(step.third)}`, 'Why this point is T', `<p>The x-coordinate comes from the intersection formula: <code>xT = x₃ = ${step.third.x}</code>.</p><p>Substitute it into the helper line: <code>yT = ${step.slope}(${step.third.x} − ${step.P.x}) + ${step.P.y} = ${lineYRaw}</code>. ${modularBreakdown(lineYRaw, step.third.y, p)}</p><p>Checking the curve gives <code>${step.third.y}² mod ${p} = ${mod(step.third.y ** 2, p)}</code> and <code>(${step.third.x}³ + ${model.curve.a}·${step.third.x} + ${model.curve.b}) mod ${p} = ${mod(step.third.x ** 3 + model.curve.a * step.third.x + model.curve.b, p)}</code>. Thus T is the third curve point on the helper line.</p>`);
            explanation.innerHTML = `<p><strong>Purple + marks</strong> sample the helper line <code>${helperLine}</code>. They are line samples, not extra curve points; only samples satisfying the curve equation are on the curve.</p><p><strong>${thirdHelp}</strong> is the third intersection with the curve (it can coincide with an input). ${reflection}</p>`;
        } else if (step.kind === 'inverse') {
            explanation.innerHTML = `<p>The purple dashed line is <code>x = ${step.P.x}</code>. Both input points have this x coordinate and opposite y values modulo ${p}. Their sum is <strong>O</strong>, so there is no finite T or reflection to draw.</p>`;
        } else {
            explanation.textContent = step.kind === 'start'
                ? 'Start at O. Advance to an addition or doubling to see its helper line and third intersection T.'
                : 'This step uses the identity rule: O + P = P. No helper line or reflection is needed.';
        }
    }

    function renderPlot() {
        if (!model) return;
        const { curve, points, G, Q, trace } = model, step = trace[index];
        renderConstruction(step);
        const width = Math.max(240, $('plot-container').clientWidth);
        const left = width < 400 ? 35 : 44, right = 26, top = 46, bottom = 40;
        const size = Math.min(width - left - right, 540), height = size + top + bottom;
        const offset = (width - left - right - size) / 2;
        const x0 = left + offset;
        const X = x => x0 + x / (curve.p - 1) * size;
        const Y = y => top + size - y / (curve.p - 1) * size;
        const O = { x: x0 + size - 18, y: 22 };
        const screen = P => P === null ? O : { x: X(P.x), y: Y(P.y) };
        const svg = $('curve-plot');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const visited = new Set(trace.slice(0, index + 1).map(s => point(s.result)));
        const maxTicks = width < 400 ? 4 : 8;
        const stride = Math.ceil((curve.p - 1) / maxTicks);
        const ticks = [...new Set([...Array.from({ length: Math.floor((curve.p - 1) / stride) + 1 }, (_, i) => i * stride), curve.p - 1])];
        let html = `<title id="plot-svg-title">${formula(curve.a, curve.b)} modulo ${curve.p}</title><desc id="plot-svg-desc">${points.length} finite curve points and the separate identity O. Step ${index}: ${step.expression}. The current arrow is solid green. Previous arrows are dashed blue and fade with age. Purple crosses sample a helper line; they need not lie on the curve.</desc><defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="var(--green)"/></marker><clipPath id="plot-clip"><rect x="${x0 - 5}" y="${top - 5}" width="${size + 10}" height="${size + 10}"/></clipPath></defs>`;
        html += ticks.map(v => `<line class="grid-line" x1="${X(v)}" y1="${top}" x2="${X(v)}" y2="${top + size}"/><line class="grid-line" x1="${x0}" y1="${Y(v)}" x2="${x0 + size}" y2="${Y(v)}"/><text x="${X(v)}" y="${top + size + 19}" text-anchor="middle">${v}</text><text x="${x0 - 12}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join('');
        html += `<rect class="plot-frame" x="${x0}" y="${top}" width="${size}" height="${size}"/><text class="axis-label" x="${x0 + size + 14}" y="${top + size + 4}">x</text><text class="axis-label" x="${x0 - 4}" y="${top - 16}">y</text><text x="${x0}" y="${height - 7}">All coordinates are mod ${curve.p}</text>`;
        html += `<g clip-path="url(#plot-clip)">`;
        if ($('construction').checked && (step.kind === 'add' || step.kind === 'double')) {
            for (let x = 0; x < curve.p; x++) {
                const y = mod(step.slope * (x - step.P.x) + step.P.y, curve.p);
                const cx = X(x), cy = Y(y), radius = curve.p > 101 ? 1.4 : 2.5;
                html += `<path class="modular-sample" d="M ${cx - radius} ${cy} H ${cx + radius} M ${cx} ${cy - radius} V ${cy + radius}"/>`;
            }
            html += `<line class="reflection" x1="${X(step.third.x)}" y1="${Y(step.third.y)}" x2="${X(step.result.x)}" y2="${Y(step.result.y)}"/>`;
        } else if ($('construction').checked && step.kind === 'inverse') {
            html += `<line class="reflection" x1="${X(step.P.x)}" y1="${top}" x2="${X(step.P.x)}" y2="${top + size}"/>`;
        }
        const dotRadius = curve.p <= 31 ? 3.5 : curve.p <= 101 ? 2.5 : 1.8;
        html += points.map(P => `<circle class="${visited.has(point(P)) ? 'visited-dot' : 'curve-dot'}" cx="${X(P.x)}" cy="${Y(P.y)}" r="${dotRadius}"/>`).join('');
        html += '</g>';
        const movementPath = operation => {
            const source = screen(operation.P), destination = screen(operation.result);
            const mid = { x: (source.x + destination.x) / 2, y: Math.max(9, (source.y + destination.y) / 2 - Math.min(55, size * .15)) };
            const length = Math.hypot(destination.x - mid.x, destination.y - mid.y) || 1;
            const ux = (destination.x - mid.x) / length, uy = (destination.y - mid.y) / length;
            return {
                path: `M ${source.x} ${source.y} Q ${mid.x} ${mid.y} ${destination.x} ${destination.y}`,
                head: `M ${destination.x - 6 * ux - 3 * uy} ${destination.y - 6 * uy + 3 * ux} L ${destination.x} ${destination.y} L ${destination.x - 6 * ux + 3 * uy} ${destination.y - 6 * uy - 3 * ux}`
            };
        };
        for (let previous = 1; previous < index; previous++) {
            const age = index - previous;
            const opacity = Math.max(.07, .7 * .78 ** (age - 1));
            const recency = Math.max(0, 100 - (age - 1) * 14);
            const movement = movementPath(trace[previous]);
            html += `<g class="history-arrow" data-step="${previous}" data-age="${age}" style="opacity:${opacity};--trail-recency:${recency}%"><path class="history-body" d="${movement.path}"/><path d="${movement.head}"/></g>`;
        }
        if (index > 0) html += `<path id="movement-path" class="step-arrow" marker-end="url(#arrowhead)" d="${movementPath(step).path}"/>`;
        const labelPoints = new Map();
        const addLabel = (P, name, color, radius) => {
            const key = point(P);
            if (labelPoints.has(key)) { const existing = labelPoints.get(key); existing.name += ` / ${name}`; if (name === 'R') existing.color = color; }
            else labelPoints.set(key, { P, name, color, radius });
        };
        if ($('construction').checked && step.third) addLabel(step.third, 'T', 'var(--purple)', 5);
        if (step.P !== undefined && step.P !== null && !equal(step.P, G)) addLabel(step.P, 'P', 'var(--accent)', 6);
        addLabel(G, 'G', 'var(--amber)', 6);
        if (Q !== null && !equal(Q, step.result) && !equal(Q, G)) addLabel(Q, 'Q', 'var(--green)', 5);
        if (step.result !== null) {
            addLabel(step.result, 'R', 'var(--green)', 7);
            if (index === trace.length - 1) addLabel(step.result, 'Q', 'var(--green)', 7);
        }
        const boxes = [];
        for (const { P, name, color, radius } of labelPoints.values()) {
            const S = screen(P), isFinal = name === 'Q';
            html += `<circle cx="${S.x}" cy="${S.y}" r="${radius}" fill="${isFinal ? 'var(--plot)' : color}" stroke="${color}" stroke-width="${isFinal ? 1.4 : 2}"/>`;
            const label = `${name} ${point(P)}`, labelWidth = label.length * 6.5;
            const anchor = S.x + labelWidth + 12 > x0 + size ? 'end' : 'start';
            const tx = S.x + (anchor === 'end' ? -10 : 10);
            let ty = S.y < top + 22 ? S.y + 21 : S.y - 11;
            const boxX = anchor === 'end' ? tx - labelWidth : tx;
            for (let attempt = 0; attempt < 8; attempt++) {
                if (!boxes.some(B => boxX < B.x + B.w + 5 && boxX + labelWidth + 5 > B.x && Math.abs(ty - B.y) < 17)) break;
                ty += 18;
                if (ty > top + size - 3) ty = S.y - 29 - attempt * 18;
            }
            boxes.push({ x: boxX, y: ty, w: labelWidth });
            html += `<text class="point-label" text-anchor="${anchor}" x="${tx}" y="${ty}">${label}</text>`;
        }
        html += `<circle cx="${O.x}" cy="${O.y}" r="10" fill="${step.result === null ? 'var(--green)' : 'var(--panel)'}" stroke="var(--green)" stroke-width="1"/><text text-anchor="middle" x="${O.x}" y="${O.y + 4}" style="fill:${step.result === null ? 'var(--background)' : 'var(--green)'}">O</text><text class="infinity-label" text-anchor="end" x="${O.x - 17}" y="${O.y + 4}">point at infinity</text>`;
        if (index > 0) html += '<circle id="moving-dot" r="5" fill="var(--green)" stroke="var(--plot)" stroke-width="2" visibility="hidden"/>';
        html += points.map(P => `<circle class="point-hit" data-x="${P.x}" data-y="${P.y}" cx="${X(P.x)}" cy="${Y(P.y)}" r="${Math.max(dotRadius + 4, Math.min(10, size / curve.p / 2))}"/>`).join('');
        svg.innerHTML = html;
        if (animation) drawAnimation();
    }

    function drawAnimation() {
        const path = $('movement-path'), dot = $('moving-dot');
        if (!path || !dot || !animation) return;
        const length = path.getTotalLength();
        const fraction = Math.min(1, (performance.now() - animation.started) / animation.duration);
        const eased = fraction * fraction * (3 - 2 * fraction);
        const P = path.getPointAtLength(length * eased);
        path.style.strokeDasharray = `${length * eased} ${length}`;
        dot.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', P.x);
        dot.setAttribute('cy', P.y);
        if (fraction < 1) frame = requestAnimationFrame(drawAnimation);
        else {
            animation = null;
            path.style.strokeDasharray = '';
            dot.setAttribute('visibility', 'hidden');
            continuePlayback();
        }
    }

    function continuePlayback() {
        if (!playing) return;
        if (index >= model.trace.length - 1) { stop(); return; }
        timer = setTimeout(() => setStep(index + 1, true), (reducedMotion.matches ? 600 : 300) / Number($('speed').value));
    }

    function cancelAnimation() {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        animation = null;
        if ($('moving-dot')) $('moving-dot').setAttribute('visibility', 'hidden');
        if ($('movement-path')) $('movement-path').style.strokeDasharray = '';
    }

    function stop() {
        playing = false;
        cancelAnimation();
        $('play').textContent = '▶ Play';
        $('play').setAttribute('aria-label', 'Play steps');
    }

    function setStep(next, animate = false) {
        cancelAnimation();
        index = Math.max(0, Math.min(model.trace.length - 1, next));
        renderStep();
        if (animate && index > 0 && !reducedMotion.matches) {
            animation = { started: performance.now(), duration: 950 / Number($('speed').value) };
            drawAnimation();
        } else continuePlayback();
    }

    function navigate(next) { stop(); setStep(next, true); }
    function togglePlay() {
        if (!model || model.trace.length === 1) return;
        if (playing) { stop(); return; }
        if (index >= model.trace.length - 1) setStep(0);
        playing = true;
        $('play').textContent = 'Ⅱ Pause';
        $('play').setAttribute('aria-label', 'Pause steps');
        setStep(index + 1, true);
    }

    function choosePoint(P) {
        try {
            const draft = readCurve();
            if (draft.a !== model.curve.a || draft.b !== model.curve.b || draft.p !== model.curve.p) {
                throw new Error('Build your curve changes before choosing G from the plot.');
            }
            inputs.gx.value = P.x;
            inputs.gy.value = P.y;
            $('preset').value = 'custom';
            build();
        } catch (error) { setError(error.message); }
    }

    form.addEventListener('submit', event => { event.preventDefault(); build(); });
    for (const field of Object.values(inputs)) field.addEventListener('input', () => {
        $('preset').value = 'custom';
        $('parameter-notice').textContent = 'Parameter changes are ready. Build to apply them.';
        if (field === inputs.a || field === inputs.b) { equationEdited = false; syncEquation(); }
    });
    $('formula').addEventListener('input', () => {
        equationEdited = true;
        $('preset').value = 'custom';
        $('parameter-notice').textContent = 'Equation changes are ready. Build to apply them.';
        try { const values = parseFormula($('formula').value); inputs.a.value = values.a; inputs.b.value = values.b; } catch { /* Allow partial equations while typing. */ }
    });
    $('method').addEventListener('change', () => { $('parameter-notice').textContent = 'Build to use the selected method.'; });
    $('preset').addEventListener('change', () => loadPreset($('preset').value));
    $('pick-point').addEventListener('click', () => {
        try {
            const curve = readCurve(), points = enumeratePoints(curve);
            if (!points.length) throw new Error('This curve has only O and no finite base point. Choose a different curve.');
            const current = points.findIndex(P => P.x === Number(inputs.gx.value) && P.y === Number(inputs.gy.value));
            const P = points[(current + 1) % points.length];
            inputs.gx.value = P.x;
            inputs.gy.value = P.y;
            $('preset').value = 'custom';
            build();
        } catch (error) { setError(error.message); }
    });
    $('curve-plot').addEventListener('click', event => {
        const hit = event.target.closest('[data-x]');
        if (hit) choosePoint({ x: Number(hit.dataset.x), y: Number(hit.dataset.y) });
    });
    $('curve-plot').addEventListener('pointermove', event => {
        const hit = event.target.closest('[data-x]'), tooltip = $('point-tooltip');
        tooltip.hidden = !hit;
        if (!hit) { $('hover-point').textContent = 'Click a point to set G'; return; }
        const label = `(${hit.dataset.x}, ${hit.dataset.y})`, bounds = $('plot-container').getBoundingClientRect();
        $('hover-point').textContent = label;
        tooltip.textContent = `${label} · set G`;
        tooltip.style.left = `${Math.max(4, Math.min(bounds.width - 150, event.clientX - bounds.left + 12))}px`;
        tooltip.style.top = `${Math.max(4, event.clientY - bounds.top - 35)}px`;
    });
    $('curve-plot').addEventListener('pointerleave', () => { $('point-tooltip').hidden = true; $('hover-point').textContent = 'Click a point to set G'; });
    $('first-step').addEventListener('click', () => navigate(0));
    $('last-step').addEventListener('click', () => navigate(model.trace.length - 1));
    $('previous-step').addEventListener('click', () => navigate(index - 1));
    $('next-step').addEventListener('click', () => navigate(index + 1));
    $('play').addEventListener('click', togglePlay);
    $('step-slider').addEventListener('input', () => navigate(Number($('step-slider').value)));
    $('construction').addEventListener('change', () => { cancelAnimation(); renderPlot(); continuePlayback(); });
    $('trace-list').addEventListener('click', event => { const row = event.target.closest('[data-step]'); if (row) navigate(Number(row.dataset.step)); });
    new ResizeObserver(() => { cancelAnimation(); renderPlot(); continuePlayback(); }).observe($('plot-container'));

    document.addEventListener('pointerover', event => {
        const trigger = event.target.closest('[data-formula-help]');
        if (trigger && (!formulaHelpPinned || trigger === activeFormulaHelp)) showFormulaHelp(trigger, formulaHelpPinned);
    });
    document.addEventListener('pointerout', event => {
        const trigger = event.target.closest('[data-formula-help]');
        if (trigger && !formulaHelpPinned && !trigger.contains(event.relatedTarget)) hideFormulaHelp();
    });
    document.addEventListener('focusin', event => {
        const trigger = event.target.closest('[data-formula-help]');
        if (trigger) showFormulaHelp(trigger, false);
    });
    document.addEventListener('focusout', event => {
        if (event.target.closest('[data-formula-help]') && !formulaHelpPinned) hideFormulaHelp();
    });
    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-formula-help]');
        if (trigger) {
            event.stopPropagation();
            if (trigger === activeFormulaHelp && formulaHelpPinned) hideFormulaHelp();
            else showFormulaHelp(trigger, true);
        } else if (formulaHelpPinned && !event.target.closest('#formula-tooltip')) hideFormulaHelp();
    });
    window.addEventListener('resize', positionFormulaHelp);
    window.addEventListener('scroll', positionFormulaHelp, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && activeFormulaHelp) {
            event.preventDefault();
            hideFormulaHelp();
        }
    });

    const dialog = $('theory-dialog');
    $('help-button').addEventListener('click', () => { stop(); dialog.showModal(); document.body.style.overflow = 'hidden'; });
    $('close-help').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { document.body.style.overflow = ''; });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    document.addEventListener('keydown', event => {
        if (dialog.open || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(event.target.tagName)) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); navigate(index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(index - 1); }
        if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    });
    loadPreset('classic');
})();
