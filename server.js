const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { Server } = require('socket.io');
const stories = require('./stories');

const app = express();
const httpServer = require('http').createServer(app);
const io = new Server(httpServer);

const rooms = new Map();

const fs = require('fs');
const publicDir = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : path.join(__dirname);
app.use(express.static(publicDir));

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

httpServer.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${err.port || process.env.PORT || 3000} déjà utilisé. Fermez le processus qui l'occupe ou définissez la variable PORT.`);
    process.exit(1);
  }
  console.error('Erreur du serveur HTTP:', err);
  process.exit(1);
});

const publicStories = () =>
  stories.map(({ solution, characters, roles, culprit, truth, ...story }) => story);

const newCode = () => {
  let code;

  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(code));

  return code;
};

const voteOutcome = accusations => {
  const scores = new Map();

  accusations.forEach(({ suspectName }) => {
    scores.set(
      suspectName,
      (scores.get(suspectName) || 0) + 1
    );
  });

  if (!scores.size) {
    return {
      highest: 0,
      eliminated: []
    };
  }

  const highest = Math.max(...scores.values());

  return {
    highest,
    eliminated: [...scores]
      .filter(([, score]) => score === highest)
      .map(([name]) => name)
  };
};

const serialiseRoom = (room, playerId = null) => {
  const base = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    accusationOpen: room.accusationOpen,
    voteClosed: room.voteClosed,
    voteProgress: room.accusationOpen
      ? { submitted: room.accusations.length, total: room.players.length }
      : null,
    accusations: room.voteClosed
      ? room.accusations.map(({ voterName, suspectName, motive }) => ({ voterName, suspectName, motive }))
      : [],
    elimination: room.voteClosed ? voteOutcome(room.accusations) : null
  };

  base.players = room.players.map(({ id, name, characterId, characterRole }) => {
    const character = room.story?.characters?.find(c => c.id === characterId);
    const characterName = character?.identity || 'Personnage inconnu';
    return { id, name, characterId, characterName, characterRole: characterRole || (character ? (character.isCulprit ? 'Coupable' : (character.isSuspect ? 'Suspect' : 'Témoin')) : 'Inconnu') };
  });

  if (room.story) {
    const { solution, characters, roles, culprit, truth, ...rest } = room.story;
    base.story = { ...rest, characters: (characters || []).map(({ id, identity }) => ({ id, identity })) };
  } else {
    base.story = null;
  }

  base.hasVoted = playerId ? room.accusations.some(a => a.playerId === playerId) : false;

  return base;
};

const chooseCharactersForRoom = (story, playerCount) => {
  const available = [...story.characters];
  return available.length <= playerCount
    ? available
    : available.slice(0, playerCount);
};

const assignRoomRoles = (story, selected) => {
  const characters = selected.map(character => ({ ...character }));
  const culpritIndex = crypto.randomInt(characters.length);
  const suspectCount = Math.min(2, characters.length - 1);
  const suspectIndexes = new Set();

  for (let i = 1; i <= suspectCount; i += 1) {
    suspectIndexes.add((culpritIndex + i) % characters.length);
  }

  const culprit = characters[culpritIndex];
  const culpritName = culprit?.identity || 'un personnage';

  characters.forEach((character, index) => {
    character.isCulprit = index === culpritIndex;
    character.isSuspect = suspectIndexes.has(index);

    if (character.isCulprit && !character.privateClue) {
      const evidenceHint = Array.isArray(story.caseFile?.evidence) && story.caseFile.evidence.length
        ? story.caseFile.evidence[index % story.caseFile.evidence.length]
        : null;
      character.privateClue = `Indice privé : ${evidenceHint || 'un détail compromettant'} semble vous relier à l’événement.`;
    }
  });

  for (let i = characters.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = characters[i];
    characters[i] = characters[j];
    characters[j] = tmp;
  }

  const truthText = (story && story.truth) || (story.solution && (story.solution.title || story.solution.explanation)) || '';
  const safeCulpritName = culpritName || 'un personnage';
  const explanation = `${truthText || ''}`.replace(/^undefined\s*/, '') + (truthText ? ' ' : '') + `Le coupable est ${safeCulpritName}.`;
  const title = (story.solution && story.solution.title) || (truthText ? `La vérité : ${truthText}` : 'La vérité');

  return {
    ...story,
    characters,
    solution: {
      ...story.solution,
      title,
      culprit: culprit?.id,
      explanation
    }
  };
};

const tellRoom = room => {
  io
    .to(room.code)
    .emit('room:update', serialiseRoom(room));
};

const cleanupRoom = room => {
  const connectedPlayers = room.players.some(
    player => player.id
  );

  if (!connectedPlayers) {
    rooms.delete(room.code);
  }
};

io.on('connection', socket => {

  socket.on('room:create', ({ name, token }, reply) => {
    const safeName = String(name || '')
      .trim()
      .slice(0, 30);

    if (!safeName) {
      return reply({
        error: 'Choisissez un prénom ou un pseudo.'
      });
    }

    const code = newCode();

    const playerToken =
      token || crypto.randomUUID();

    const room = {
      code,
      hostId: socket.id,
      phase: 'lobby',

      players: [
        {
          id: socket.id,
          name: safeName,
          token: playerToken
        }
      ],

      story: null,
      accusationOpen: false,
      voteClosed: false,
      accusations: []
    };

    rooms.set(code, room);

    socket.join(code);

    return reply({
      room: serialiseRoom(room, socket.id),
      playerId: socket.id,
      token: playerToken,
      name: safeName
    });
  });

  socket.on('room:join', ({ code, name, token }, reply) => {
    const room = rooms.get(
      String(code || '').toUpperCase()
    );

    if (!room) {
      return reply({
        error: 'Cette salle est introuvable.'
      });
    }

    const playerToken =
      token || crypto.randomUUID();

    const existingPlayer = room.players.find(
      player =>
        player.token &&
        player.token === playerToken
    );

    if (existingPlayer) {
      const oldSocketId = existingPlayer.id;

      const wasHost =
        room.hostId === oldSocketId;

      existingPlayer.id = socket.id;

      if (wasHost) {
        room.hostId = socket.id;
      }

      socket.join(room.code);

      tellRoom(room);

      return reply({
        room: serialiseRoom(room, socket.id),
        playerId: socket.id,
        token: existingPlayer.token,
        name: existingPlayer.name
      });
    }

    if (
      room.story &&
      room.players.length >= room.story.maxPlayers
    ) {
      return reply({
        error: 'Cette salle est complète.'
      });
    }

    const safeName = String(name || '')
      .trim()
      .slice(0, 30);

    if (!safeName) {
      return reply({
        error: 'Choisissez un prénom ou un pseudo.'
      });
    }

    const player = {
      id: socket.id,
      name: safeName,
      token: playerToken
    };

    room.players.push(player);

    socket.join(room.code);

    tellRoom(room);

    return reply({
      room: serialiseRoom(room, socket.id),
      playerId: socket.id,
      token: playerToken,
      name: safeName
    });
  });

  socket.on('story:list', reply => {
    reply(publicStories());
  });

  socket.on('story:select', ({ code, storyId }, reply) => {
    const room = rooms.get(
      String(code || '').toUpperCase()
    );

    const story = stories.find(
      item => item.id === storyId
    );

    if (
      !room ||
      room.hostId !== socket.id
    ) {
      return reply({
        error: 'Seul l’hôte peut choisir l’histoire.'
      });
    }

    if (!story) {
      return reply({
        error: 'Histoire introuvable.'
      });
    }

    if (
      room.players.length < story.minPlayers ||
      room.players.length > story.maxPlayers
    ) {
      return reply({
        error:
          `Cette histoire accepte ${story.minPlayers} à ${story.maxPlayers} joueurs.`
      });
    }

    const selected = chooseCharactersForRoom(story, room.players.length);
    room.story = assignRoomRoles(story, selected);
    room.phase = 'playing';
    room.accusations = [];
    room.accusationOpen = false;
    room.voteClosed = false;

    room.players.forEach((player, index) => {
      const char = room.story.characters[index] || null;
      player.characterId = char ? char.id : null;
      player.characterRole = char ? (char.isCulprit ? 'Coupable' : (char.isSuspect ? 'Suspect' : 'Témoin')) : 'Inconnu';
    });

    tellRoom(room);

    return reply({
      ok: true
    });
  });

  socket.on('sheet:get', ({ code }, reply) => {
    const room = rooms.get(
      String(code || '').toUpperCase()
    );

    const player = room?.players.find(
      item => item.id === socket.id
    );

    const character =
      room?.story?.characters.find(
        item =>
          item.id === player?.characterId
      );

    if (!character) {
      return reply({
        error:
          'Votre fiche n’est pas encore disponible.'
      });
    }

    const {
      profile,
      medical,
      scene,
      questions = [],
      evidence = [],
      ...baseCaseFile
    } = room.story.caseFile;

    return reply({
      character,

      caseFile: {
        ...baseCaseFile,

        evidence: [
          ...(profile
            ? [
                `Victime / personne recherchée : ${profile}`
              ]
            : []),

          ...(medical
            ? [`État constaté : ${medical}`]
            : []),

          ...(scene
            ? [`Scène : ${scene}`]
            : []),

          ...questions.map(
            question =>
              `Question à résoudre : ${question}`
          ),

          ...evidence
        ]
      }
    });
  });

  socket.on(
    'accusation:open',
    ({ code }, reply) => {
      const room = rooms.get(
        String(code || '').toUpperCase()
      );

      if (
        !room ||
        room.hostId !== socket.id ||
        room.phase !== 'playing'
      ) {
        return reply({
          error: 'Action impossible.'
        });
      }

      room.accusationOpen = true;
      room.voteClosed = false;
      room.accusations = [];

      tellRoom(room);

      return reply({
        ok: true
      });
    }
  );

  socket.on(
    'accusation:submit',
    ({ code, suspectId, motive }, reply) => {
      const room = rooms.get(
        String(code || '').toUpperCase()
      );

      const player = room?.players.find(
        item => item.id === socket.id
      );

      if (
        !room ||
        !player ||
        !room.accusationOpen
      ) {
        return reply({
          error:
            'Les accusations ne sont pas ouvertes.'
        });
      }

      room.accusations =
        room.accusations.filter(
          item =>
            item.playerId !== socket.id
        );

      const suspect =
        room.story.characters.find(
          character =>
            character.id === suspectId
        );

      if (!suspect) {
        return reply({
          error: 'Suspect invalide.'
        });
      }

      const voter =
        room.story.characters.find(
          character =>
            character.id === player.characterId
        );

      room.accusations.push({
        playerId: socket.id,
        voterName: voter.identity,
        suspectName: suspect.identity,
        motive: String(motive || '')
          .slice(0, 240)
      });

      if (
        room.accusations.length ===
        room.players.length
      ) {
        room.accusationOpen = false;
        room.voteClosed = true;
      }

      tellRoom(room);

      return reply({
        ok: true
      });
    }
  );

  socket.on(
    'solution:reveal',
    ({ code }, reply) => {
      const room = rooms.get(
        String(code || '').toUpperCase()
      );

      if (
        !room ||
        room.hostId !== socket.id ||
        room.phase !== 'playing'
      ) {
        return reply({
          error: 'Action impossible.'
        });
      }

      room.phase = 'solved';

      tellRoom(room);

      io
        .to(room.code)
        .emit(
          'solution:show',
          room.story.solution
        );

      return reply({
        ok: true
      });
    }
  );

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find(
        item => item.id === socket.id
      );

      if (!player) {
        continue;
      }

      player.id = null;

      if (room.hostId === socket.id) {
        room.hostId = null;
      }

      tellRoom(room);

      cleanupRoom(room);
    }
  });
});

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

function tryListen(port, attemptsLeft = 10) {
  const onListening = () => {
    console.log(`Nocturne lancé sur le port ${port}`);
    httpServer.removeListener('error', onError);
  };

  const onError = err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${port} déjà utilisé.`);
      httpServer.removeListener('listening', onListening);
      httpServer.removeListener('error', onError);
      if (attemptsLeft > 0) {
        const nextPort = port + 1;
        console.log(`Tentative sur le port ${nextPort} (${attemptsLeft - 1} essais restants)...`);
        setTimeout(() => tryListen(nextPort, attemptsLeft - 1), 200);
        return;
      }
      console.error('Aucun port disponible trouvé (essais épuisés). Fermez le processus qui écoute sur le port ou définissez la variable PORT.');
      process.exit(1);
    }
    throw err;
  };

  httpServer.once('listening', onListening);
  httpServer.once('error', onError);
  httpServer.listen(port);
}

tryListen(DEFAULT_PORT);