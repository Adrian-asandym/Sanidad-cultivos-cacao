
const DISEASES = {
  moniliasis: /\b(?:moniliasis|monilia|moniliophthora roreri|pasmo)\b/,
  fitoftora: /\b(?:fitoftora|fitoptora|phytophthora|mazorcas? negras?)\b/,
  escoba_de_bruja: /\b(?:escobas?(?: de brujas?)?|(?:moniliophthora|crinipellis) perniciosa)\b/,
};

const STOP = new Set((
  'a al algo ante apartir aqui asi bajo cada como cual cuales cuando cuanta cuantas cuanto cuantos ' +
  'con contra cual de del debo debe deben desde donde dos durante e el ella en entre es esa ese ' +
  'eso esta estan este esto estos fue ha hacer hay la las le lo los mas me mi muy necesito no nos ' +
  'o otra para pero por puedo puede pueden que quiero recomiendas recomienda saber se ser si sin ' +
  'sobre son su sus te tengo tiene tienen todo tras tu un una unas uno y ya cacao cacaotal cultivo ' +
  'planta plantacion enfermedad enfermedades hongo hongos fruto frutos mazorca mazorcas caso ' +
  'tiempo forma mejor debo debemos indica indican guia guias sirve cual cuanto cuantas veces ' +
  'ayuda ayudan hago regulo haber ver aparece parecen ocurre'
).split(' '));

const CONCEPTS = [
  ['poda', /^(?:pod[aeo]|podar|podas|poden|raleo|aireaci|ventil|deschupon)/],
  ['drenaje', /^(?:dren|encharc|empoz|estanc)/],
  ['sombra', /^(?:sombr|sombre|luminos)/],
  ['retiro', /^(?:recolect|recolec|retir|recoj|recog|remoci|remov|quitar|retiro|purga|re-se)/],
  ['residuo', /^(?:enterr|inciner|desech|descart|elimin|residu)/],
  ['sintoma', /^(?:sintom|signo|recono|cambio|identific|detect|disting|aspecto)/],
  ['mancha', /^manch/],
  ['deformacion', /^(?:deform|abult)/],
  ['prevencion', /^(?:preven|evit|proteccion|vigil|monitor|revis)/],
  ['manejo', /^(?:control|trat|manej|combat|mitig|practica|reduce|reducir|cura|curar)/],
  ['frecuencia', /^(?:frecuen|seman|calendar|periodic)/],
  ['propagacion', /^(?:propag|transmi|contag|dispers|esporul)/],
  ['humedad', /^(?:humed|mojad|lluv|humedec)/],
  ['agente', /^(?:patogen|caus|agente|origina|provoc)/],
  ['fertilidad', /^(?:fertil|abono|abonad|nutric)/],
];

const INTENT = new Set(['manejo', 'sintoma', 'prevencion', 'frecuencia', 'agente', 'propagacion']);
const OUT_OF_SCOPE = /\b(?:dosis|fungicidas?|pesticidas?|plaguicidas?|quimic[oa]s?|herbicidas?|gramos por|mililitros|precio|precios|recetas?)\b/;
const SOURCE_NAMES = {
  'cartilla-cacao-ICA.pdf': 'Cartilla fitosanitaria del ICA',
  'Guia-Manejo-Integrado-Cacao.pdf': 'Guía de manejo integrado del cultivo de cacao',
};

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function terms(text) {
  return new Set(
    (normalize(text).match(/re-se|[a-z]{3,}/g) || [])
      .filter((word) => !STOP.has(word))
      .map((word) => CONCEPTS.find(([, pattern]) => pattern.test(word))?.[0]
        || word.replace(/(?:es|s)$/, ''))
  );
}

function excerpts(text) {
  // Mantiene juntas las líneas de cada viñeta y evita partir iniciales y abreviaturas.
  return text.split(/\n+/).flatMap((paragraph) => paragraph
    .replace(/(?:\b[A-Z]|\bsp|\bspp|\bvar|\bal)\.(?= )/g, (part) => part.replace('.', '\u0001'))
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ])/u)
    .map((part) => part.replaceAll('\u0001', '.').trim()))
    .filter((part) => part.length >= 30);
}

let indexPromise;

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('./data/cacao_chunks.jsonl')
      .then((response) => {
        if (!response.ok) throw new Error('No se pudo cargar el corpus');
        return response.text();
      })
      .then((jsonl) => {
        const records = jsonl.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        if (!records.length || records.some((r) => !r.texto?.trim() || !r.seccion
          || !Object.hasOwn(SOURCE_NAMES, r.fuente) || !r.paginas?.length)) {
          throw new Error('El corpus no contiene los campos esperados');
        }
        const documents = records.map((record) => ({
          ...record,
          terms: terms(record.seccion + ' ' + record.texto),
          titleTerms: terms(record.seccion),
          excerpts: excerpts(record.texto).map((text) => ({ text, terms: terms(text) })),
        }));
        const frequency = new Map();
        for (const doc of documents) {
          for (const token of doc.terms) frequency.set(token, (frequency.get(token) || 0) + 1);
        }
        return { documents, frequency };
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

function bestExcerpt(doc, query, weight) {
  const candidates = doc.excerpts.map((part, i) => ({
    i,
    score: query.reduce((total, word) => total + (part.terms.has(word) ? weight(word) : 0), 0),
  }));
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  if (!candidates[0]?.score) return doc.texto;
  const first = candidates[0].i;
  const current = doc.excerpts[first].text;
  const next = doc.excerpts[first + 1]?.text;
  const ordinal = /^\d+\.\s*/;
  if (next && current.length + next.length < 450 && !next.startsWith('•') && !ordinal.test(next)) {
    return current + ' ' + next;
  }
  return current;
}

export async function consult(question, context) {
  const normalized = normalize(question);
  if (OUT_OF_SCOPE.test(normalized)) return [];
  const explicit = Object.keys(DISEASES).filter((key) => DISEASES[key].test(normalized));
  const queryText = Object.values(DISEASES).reduce((value, pattern) => value.replace(pattern, ' '), normalized);
  const query = [...terms(queryText.replace(/\bagua acumulada\b/g, 'drenaje'))];
  if (/\b(?:cada cuanto|con que frecuencia|cuando recojo|cuando retiro)\b/.test(normalized)
    && !query.includes('frecuencia')) query.push('frecuencia');
  const scoped = explicit.length ? explicit : context && context !== 'sano' ? [context] : [];
  if (!query.length && !explicit.length) return [];

  const { documents, frequency } = await loadIndex();
  const symptoms = query.some((word) => ['sintoma', 'mancha', 'deformacion', 'color'].includes(word));
  const preventive = query.some((word) => ['manejo', 'prevencion', 'retiro', 'residuo', 'poda', 'drenaje'].includes(word));
  const management = preventive && !symptoms && !query.some((word) => ['agente', 'propagacion'].includes(word));
  const fruitSymptoms = symptoms && !/\b(?:raiz|raices|tronco|hojas?|ramas?|plantulas?|vivero)\b/.test(normalized);
  const specific = query.filter((word) => !INTENT.has(word));
  const weight = (word) => 1 + Math.log((documents.length + 1) / ((frequency.get(word) || 0) + 1));
  const ranked = documents.flatMap((doc) => {
    const isGeneral = doc.enfermedad === 'general';
    const isScoped = scoped.includes(doc.enfermedad);
    if (scoped.length && !isScoped && (!isGeneral || explicit.length)) return [];
    const matches = query.filter((word) => doc.terms.has(word));
    const matchesSpecific = specific.filter((word) => doc.terms.has(word));
    if (specific.length && matchesSpecific.length < Math.ceil(specific.length / 2)) return [];
    if (management && doc.tipo_control !== 'cultural') return [];
    if (symptoms && doc.tipo_control === 'cultural') return [];
    if (query.length && !matches.length && !(management && !specific.length)) return [];
    const titleScore = matches.reduce((total, word) => total + (doc.titleTerms.has(word) ? weight(word) : 0), 0);
    const matchScore = matches.reduce((total, word) => total + weight(word), 0);
    const scopeBonus = isScoped || (context === 'sano' && isGeneral) ? 1 : 0;
    const section = normalize(doc.seccion);
    const fruitBonus = fruitSymptoms && /sintomas.*(mazorca|fruto)/.test(section) ? 3 : 0;
    const rootPenalty = fruitSymptoms && /raices y tronco/.test(section) ? 3 : 0;
    return [{ doc, score: matchScore + titleScore + scopeBonus + fruitBonus - rootPenalty }];
  }).sort((a, b) => b.score - a.score);

  const broadManagement = management && !specific.length;
  const firstHasFruitSymptoms = fruitSymptoms && /sintomas.*(mazorca|fruto)/.test(normalize(ranked[0]?.doc.seccion || ''));
  const answers = [];
  for (const { doc, score } of ranked) {
    if (firstHasFruitSymptoms && /raices y tronco/.test(normalize(doc.seccion))) continue;
    if (answers.length && score < ranked[0].score * 0.55) break;
    const text = broadManagement ? doc.texto : bestExcerpt(doc, query, weight);
    if (answers.some((answer) => answer.text === text
      || (answer.section === doc.seccion && answer.disease === doc.enfermedad))) continue;
    answers.push({
      text,
      disease: doc.enfermedad,
      section: doc.seccion,
      source: SOURCE_NAMES[doc.fuente],
      pages: doc.paginas,
    });
    if (answers.length === 2) break;
  }
  return answers;
}

