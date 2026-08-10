const cleanId = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function pick(arr, index) {
  return arr[index % arr.length];
}

function buildCharacter(story, role, index) {
  if (typeof role === 'string') {
    const [name, job] = role.split('|');
    role = { name, job };
  }

  const name = role.name;
  const profession = role.job || 'Inconnu';

  const roles = story.roles || [];
  const culpritIndex = roles.findIndex(r => {
    const n = typeof r === 'string' ? r.split('|')[0] : r.name;
    return n === story.culprit || cleanId(n) === cleanId(String(story.culprit || ''));
  });

  const computedCulprit = culpritIndex >= 0 && (index === culpritIndex);
  const computedSuspect = (() => {
    if (culpritIndex < 0) return false;
    const n = roles.length;
    return n > 1 && (index === ((culpritIndex + 1) % n) || index === ((culpritIndex + 2) % n));
  })();

  const isCulprit = typeof role.isCulprit === 'boolean' ? role.isCulprit : computedCulprit;
  const isSuspect = typeof role.isSuspect === 'boolean' ? role.isSuspect : computedSuspect;

  const schedule = role.schedule || (() => {
    const baseTimes = [18, 19, 20, 21, 22];
    return baseTimes.map((hour, i) => {
      const minuteOffset = (index * 7 + i * 11) % 50;
      const minute = (10 + minuteOffset) % 60;
      const label = i === 2 ? `${hour} h ${minute} — un événement vous interrompt.` : `${hour} h ${minute} — activité ou déplacement.`;
      return label;
    });
  })();

  const itemsPool = ['Montre cassée', 'Clé marquée', 'Foulard taché', 'Bloc-notes chiffonné', 'Lampe de poche', 'Bouteille d’eau vide', 'Gant en cuir', 'Ticket froissé'];
  const secretsPool = ['Dette cachée', 'Ancienne liaison', 'Contrat compromis', 'Image compromettante', 'Dette de jeu', 'Lettre anonyme'];
  const knowsPool = ['A vu quelqu’un monter sur le balcon', 'A entendu un bruit étouffé', 'A trouvé une tasse renversée', 'Connaît le code du coffre', 'A reçu un message menaçant'];

  const item = role.item || pick(itemsPool, index + (story.id ? story.id.length : 0));
  const secret = role.secret || pick(secretsPool, index + 1);
  const knowledge = role.knowledge || pick(knowsPool, index + 2);

  const personalityPool = [
    'Calme sous pression, vous cachez votre anxiété.',
    'Direct et fier, vous détestez être soupçonné.',
    'Observateur, vous mémorisez les petits gestes.',
    'Séduisant mais prudent, vous choisissez vos silences.',
    'Méthodique, vous cherchez une explication rationnelle.',
    'Loyal en apparence, redoutable quand on vous accule.'
  ];

  const relations = role.relations || `Vous connaissiez ${story.caseFile?.victim || 'la victime'} ; certains échanges récents avec d'autres invités étaient tendus.`;

  const character = {
    id: cleanId(name),
    identity: name,
    profession,
    personality: role.personality || pick(personalityPool, index),
    relations,
    schedule,
    objectives: role.objectives || [`Protéger votre réputation`, `Découvrir qui a profité du chaos`],
    secrets: [secret],
    items: [item],
    knows: [knowledge],
    ignores: role.ignores || ['La raison exacte pour laquelle la victime avait peur ce soir.'],
    suspicions: role.suspicion || `Vous suspectez quelqu’un mais vous manquez de preuves directes.`,
    isCulprit,
    isSuspect
  };

  if (isCulprit) {
    const evidenceHint = Array.isArray(story.caseFile?.evidence) && story.caseFile.evidence.length ? story.caseFile.evidence[index % story.caseFile.evidence.length] : null;
    character.privateClue = role.privateClue || `Indice privé : ${evidenceHint || 'un détail compromettant'} semble vous relier à l’événement.`;
  }

  return character;
}

module.exports = function makeStory(config) {
  const { roles, culprit, truth, ...publicConfig } = config;
  const story = {
    ...publicConfig,
    roles,
    culprit,
    truth,
    minPlayers: publicConfig.minPlayers ?? 3,
    maxPlayers: publicConfig.maxPlayers ?? 6
  };

  const characters = (story.roles || []).map((role, index) => buildCharacter(story, role, index));


  const culpritId = (() => {
    if (!story.culprit) return null;
    const match = characters.find(c => c.identity === story.culprit || c.id === cleanId(story.culprit));
    return match ? match.id : cleanId(String(story.culprit));
  })();

  const caseFile = {
    ...publicConfig.caseFile,
    cause: publicConfig.caseFile && (publicConfig.caseFile.event || publicConfig.caseFile.medical) ? (publicConfig.caseFile.event || publicConfig.caseFile.medical) : publicConfig.caseFile?.cause || null
  };

  return {
    ...publicConfig,
    caseFile,
    minPlayers: story.minPlayers,
    maxPlayers: story.maxPlayers,
    characters,
    solution: {
      culprit: culpritId || story.culprit,
      title: `La vérité : ${story.truth}`,
      explanation: story.culprit
        ? `${story.truth} Le coupable est ${story.culprit}.`
        : story.truth
    }
  };
};
