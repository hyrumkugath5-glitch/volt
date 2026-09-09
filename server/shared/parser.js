// Offline worksheet -> candidate flashcards.
// Splits numbered problems, tries to pair an answer key, classifies each
// problem, and generates layered Socratic hints (strategy, not the answer).

const TYPES = [
  {
    id: 'quadratic',
    label: 'Quadratic equation',
    weak: true,
    test: (t) =>
      /quadratic/.test(t) ||
      (/solv|=|zero|root/.test(t) && /[a-z]\s*[\^*]\s*2\b|[a-z]²|x\^2|x2\s*[-+]/.test(t)),
    hints: [
      'Get everything on one side so the equation equals 0.',
      'Try to factor first. If it does not factor with whole numbers, use the quadratic formula: x = (−b ± √(b²−4ac)) / (2a).',
      'Identify a, b, c from ax² + bx + c = 0. Watch the signs. There are usually two solutions.',
    ],
  },
  {
    id: 'linear',
    label: 'Linear equation',
    weak: true,
    test: (t) => /solve|=/.test(t) && /[a-z]/.test(t),
    hints: [
      'Goal: get the variable by itself on one side.',
      'Undo addition and subtraction first, then undo multiplication and division. Do the same thing to both sides every step.',
      'If the variable is on both sides, move all variable terms to one side and all plain numbers to the other.',
    ],
  },
  {
    id: 'system',
    label: 'System of equations',
    test: (t) => /system of|\btwo equations\b|by substitution|by elimination|solve the system/.test(t),
    hints: [
      'You need values that make BOTH equations true at the same time.',
      'If one equation is already solved for a variable, use substitution. Otherwise use elimination: line up like terms and add or subtract to cancel one variable.',
      'After you find one variable, plug it back into either original equation to get the other.',
    ],
  },
  {
    id: 'factor',
    label: 'Factoring',
    test: (t) => /factor/.test(t),
    hints: [
      'Check for a greatest common factor (GCF) you can pull out of every term first.',
      'For x² + bx + c, find two numbers that multiply to c and add to b.',
      'Difference of squares a² − b² factors to (a − b)(a + b). Check if that pattern fits.',
    ],
  },
  {
    id: 'exponents',
    label: 'Properties of exponents',
    test: (t) => (/\^|exponent|power of a power/.test(t) && !/=/.test(t)) || /positive exponents/.test(t),
    hints: [
      'Use the exponent rules: multiply → add exponents, divide → subtract, power of a power → multiply.',
      'A negative exponent means "move it to the other side of the fraction and make it positive". x⁻ⁿ = 1/xⁿ.',
      'Anything (except 0) to the power 0 is 1. Deal with each variable and the number coefficients separately.',
    ],
  },
  {
    id: 'simplify',
    label: 'Simplify / expressions',
    test: (t) => /simplif|expand|combine like terms|distribute/.test(t),
    hints: [
      'Distribute first to clear parentheses, then combine like terms.',
      'Exponent rules: multiplying → add exponents, dividing → subtract exponents, power of a power → multiply exponents.',
      'A term is "like" another only if it has the exact same variable and exponent.',
    ],
  },
  {
    id: 'slope',
    label: 'Slope / line equations',
    test: (t) => /slope|y-?intercept|equation of (the )?line|y\s*=\s*mx/.test(t),
    hints: [
      'Slope m = (y₂ − y₁) / (x₂ − x₁). Subtract the coordinates in the same order top and bottom.',
      'Slope-intercept form is y = mx + b, where b is where the line crosses the y-axis.',
      'Have a point and a slope? Use point-slope: y − y₁ = m(x − x₁), then simplify.',
    ],
  },
  {
    id: 'midpoint',
    label: 'Midpoint',
    test: (t) => /midpoint/.test(t),
    hints: [
      'The midpoint is just the average of the two points.',
      'Midpoint = ( (x₁ + x₂) / 2 , (y₁ + y₂) / 2 ).',
    ],
  },
  {
    id: 'distance',
    label: 'Distance between points',
    test: (t) => /distance between|length of (the )?segment/.test(t),
    hints: [
      'This is the Pythagorean theorem on the coordinate plane.',
      'Distance = √( (x₂ − x₁)² + (y₂ − y₁)² ). Square the differences, add, then take the square root.',
    ],
  },
  {
    id: 'pythagorean',
    label: 'Pythagorean theorem',
    test: (t) => /pythag|hypotenuse|right triangle/.test(t),
    hints: [
      'The hypotenuse is the side opposite the right angle — always the longest side.',
      'a² + b² = c², where c is the hypotenuse. Substitute what you know, then solve for the missing side.',
      'If you are solving for a leg, rearrange: leg = √(c² − other leg²).',
    ],
  },
  {
    id: 'area',
    label: 'Area / perimeter',
    test: (t) => /\barea\b|\bperimeter\b|\bcircumference\b/.test(t),
    hints: [
      'Write the formula for that exact shape before plugging in numbers.',
      'Triangle area = ½ · base · height (height must be perpendicular to the base). Rectangle = l · w. Circle area = πr², circumference = 2πr.',
      'Check your units, and whether you were given a radius or a diameter.',
    ],
  },
  {
    id: 'volume',
    label: 'Volume / surface area',
    test: (t) => /\bvolume\b|surface area/.test(t),
    hints: [
      'Prism or cylinder volume = area of the base × height.',
      'Pyramid or cone volume = ⅓ × (area of base) × height. Sphere = (4/3)πr³.',
      'Surface area = add up the area of every face or curved surface.',
    ],
  },
  {
    id: 'angles',
    label: 'Angles',
    test: (t) => /\bangle|complementary|supplementary|vertical angles|transversal|parallel lines/.test(t),
    hints: [
      'List the angle relationships you can use: angles on a straight line add to 180°, around a point 360°, triangle interior 180°.',
      'Complementary = adds to 90°. Supplementary = adds to 180°. Vertical angles are equal.',
      'With parallel lines cut by a transversal: corresponding and alternate angles are equal; co-interior angles add to 180°.',
    ],
  },
  {
    id: 'triangle-cong',
    label: 'Congruent / similar figures',
    test: (t) => /congruent|\bsimilar\b|\bsss\b|\bsas\b|\basa\b|\baas\b|corresponding sides/.test(t),
    hints: [
      'Similar = same shape, proportional sides, equal angles. Congruent = identical.',
      'For similar triangles, set up a proportion matching corresponding sides and solve.',
      'For congruence, name the postulate: SSS, SAS, ASA, AAS, or HL.',
    ],
  },
  {
    id: 'evaluate',
    label: 'Evaluate / substitute',
    test: (t) => /evaluate|find the value|when x\s*=|substitut/.test(t),
    hints: [
      'Replace each variable with its given value — use parentheses around negatives.',
      'Then follow order of operations: parentheses, exponents, multiply/divide, add/subtract.',
    ],
  },
];

const GENERIC_HINTS = [
  'Underline what you are given and circle what the question asks for.',
  'Write down the formula or rule that connects the given information to the goal before doing any arithmetic.',
  'Estimate what a reasonable answer looks like, so you can catch a mistake.',
];

export function classify(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  // Pass 1: specific topic keywords (area, slope, Pythagorean, factor…).
  // Pass 2: generic equation shapes (quadratic, linear, system) that only
  // rely on "=" and would otherwise swallow the geometry problems.
  for (const pass of [false, true]) {
    for (const type of TYPES) {
      if (!!type.weak !== pass) continue;
      try {
        if (type.test(t)) return type;
      } catch {}
    }
  }
  return { id: 'general', label: 'General problem', hints: GENERIC_HINTS };
}

export function offlineHints(card) {
  const type = classify(card.question || '');
  return { typeLabel: type.label, hints: type.hints && type.hints.length ? type.hints : GENERIC_HINTS };
}

// ---- splitting ----
const NUM_RE = /(?:^|\n)\s*(\d{1,2})\s*[.)]\s+/g;

function cleanBlock(s) {
  let out = s
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  // strip a trailing worksheet title / instruction line that bled in from the
  // top of a column: last line, no "=", starts with a capital, mostly words
  out = out.replace(/\n(?![^\n]*=)[A-Z][A-Za-z0-9 ,'"&()—.:!?-]{12,}$/, '').trim();
  out = out.replace(/\n(?:name|date|period|class|score)\b.*$/i, '').trim();
  // strip a trailing RUN (2+) of lone-token crumbs ("m^-1", "p^3") — superscript
  // fragments that leaked in from a neighbouring problem. A run of two is the
  // signal; a single trailing short line could be a real fraction denominator.
  {
    const crumb = (l) => /^[a-z](\^-?\(?\d+\)?)?$/i.test(l.replace(/\s/g, ''));
    const lines = out.split('\n');
    if (lines.length >= 3 && lines[0].replace(/\s/g, '').length >= 14 &&
        crumb(lines[lines.length - 1]) && crumb(lines[lines.length - 2])) {
      while (lines.length > 1 && crumb(lines[lines.length - 1])) lines.pop();
      out = lines.join('\n').trim();
    }
  }
  return out;
}

// Detect an answer-key region and return { [num]: answer }
function extractAnswerKey(fullText) {
  const m0 = fullText.match(/answer\s*key|(?:^|\n)\s*(?:answers?|solutions?)\s*[:.]?\s*(?=\n|\s+\d)/i);
  if (!m0) return { key: {}, bodyEnd: fullText.length };
  const idx = m0.index;
  const region = fullText.slice(idx).replace(/answer\s*key|solutions?|answers?/i, '');
  const key = {};

  // 1) preferred: one answer per line ("1) x = 7")
  for (const line of region.split('\n')) {
    const lm = line.match(/^\s*(\d{1,2})\s*[.)]\s*(\S.*?)\s*$/);
    if (lm) key[lm[1]] = lm[2].replace(/\s+/g, ' ').trim();
  }
  if (Object.keys(key).length >= 2) return { key, bodyEnd: idx };

  // 2) fallback: answers strung on one line, separated by "  N) "
  const re = /(?:^|\s)(\d{1,2})[.)]\s+([^\n]+?)(?=\s+\d{1,2}[.)]\s|\s*$)/g;
  let m;
  while ((m = re.exec(region))) {
    const v = m[2].replace(/\s+/g, ' ').trim();
    if (v && v.length <= 40) key[m[1]] = v;
  }
  return { key, bodyEnd: idx };
}

export function splitProblems(fullText) {
  const text = (fullText || '').replace(/ /g, ' ');
  const { key, bodyEnd } = extractAnswerKey(text);
  const body = text.slice(0, bodyEnd);

  const marks = [];
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(body))) {
    marks.push({ num: parseInt(m[1], 10), start: m.index + m[0].length, markStart: m.index });
  }

  const cards = [];
  if (marks.length >= 2) {
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].markStart : body.length;
      const q = cleanBlock(body.slice(marks[i].start, end));
      if (q.length < 2) continue;
      cards.push({ number: marks[i].num, question: q, answer: key[marks[i].num] || '' });
    }
  } else {
    // fall back: split on blank lines
    const chunks = body.split(/\n\s*\n/).map(cleanBlock).filter((c) => c.length > 4);
    chunks.forEach((c, i) => cards.push({ number: i + 1, question: c, answer: '' }));
  }

  return cards.map((c) => ({ ...c, typeLabel: classify(c.question).label }));
}
