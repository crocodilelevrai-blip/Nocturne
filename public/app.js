const socket = io();
const app = document.querySelector('#app');

(function(){
  try {
    const css = `.card.solution .eyebrow{font-weight:700;font-size:14px;color:var(--paper)} .card.solution p{margin:6px 0}`;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  } catch (e) {
  }
})();

let state = JSON.parse(localStorage.getItem('nocturne-session') || 'null');
let room;
let solution;

const deviceToken =
  localStorage.getItem('nocturne-device') ||
  crypto.randomUUID();

localStorage.setItem('nocturne-device', deviceToken);

const save = () => {
  if (state) {
    localStorage.setItem('nocturne-session', JSON.stringify(state));
  }
};

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const emit = (event, data = {}) =>
  new Promise(resolve => {
    socket.emit(
      event,
      {
        ...data,
        token: deviceToken
      },
      resolve
    );
  });

function shell(content) {
  app.innerHTML = `
    <div class="brand">NOCTURNE</div>
    ${content}
  `;
}

function welcome() {
  shell(`
    <p class="subtitle">
      Le mystère est entre vos mains. Créez un salon puis partagez son code avec les autres enquêteurs.
    </p>

    <div class="card">
      <h2>Nouvelle partie</h2>
      <input id="createName" placeholder="Votre prénom / pseudo" maxlength="30">
      <button id="create">Créer le salon</button>
    </div>

    <div class="card">
      <h2>Rejoindre une partie</h2>
      <input id="joinName" placeholder="Votre prénom / pseudo" maxlength="30">
      <input id="joinCode" placeholder="Code du salon" maxlength="6" autocapitalize="characters">
      <button class="secondary" id="join">Rejoindre</button>
      <p id="error" class="error"></p>
    </div>
  `);

  document.querySelector('#create').onclick = async () => {
    const name = document.querySelector('#createName').value;

    const result = await emit('room:create', {
      name
    });

    handleJoin(result);
  };

  document.querySelector('#join').onclick = async () => {
    const name = document.querySelector('#joinName').value;
    const code = document.querySelector('#joinCode').value;

    const result = await emit('room:join', {
      name,
      code
    });

    handleJoin(result);
  };
}

function handleJoin(result) {
  if (result.error) {
    const error = document.querySelector('#error');

    if (error) {
      error.textContent = result.error;
    }

    return;
  }

  room = result.room;

  state = {
    code: room.code,
    playerId: result.playerId,
    token: result.token || deviceToken,
    name: result.name || state?.name || ''
  };

  save();
  render();
}

function lobby() {
  const host = room.hostId === socket.id;

  shell(`
    <p class="eyebrow">Salon privé</p>

    <div class="card">
      <p class="small">Partagez ce code avec vos amis</p>

      <div class="code">${esc(room.code)}</div>

      <div class="divider"></div>

      <h3>
        ${room.players.length}
        enquêteur${room.players.length > 1 ? 's' : ''}
        dans le salon
      </h3>

      ${room.players.map(p => `
        <div>
          ${esc(p.name)}
          ${!p.id ? '— déconnecté' : ''}
        </div>
      `).join('')}

      <p class="notice">
        Il faut au moins 3 joueurs. Chaque joueur choisit son pseudo depuis son propre téléphone.
      </p>

      ${
        host
          ? `<button id="stories" ${room.players.length < 3 ? 'disabled' : ''}>
              Choisir une histoire
            </button>`
          : `<p class="notice">
              L’hôte choisira une histoire quand tout le monde sera prêt.
            </p>`
      }
    </div>
  `);

  if (host) {
    document.querySelector('#stories').onclick = storyList;
  }
}

async function storyList() {
  const stories = await new Promise(resolve =>
    socket.emit('story:list', resolve)
  );

  const draw = () => {
    const players = Number(
      document.querySelector('#filterPlayers')?.value ||
      room.players.length
    );

    const difficulty =
      document.querySelector('#filterDifficulty')?.value || 'all';

    const visible = stories.filter(
      s =>
        players >= s.minPlayers &&
        players <= s.maxPlayers &&
        (difficulty === 'all' || s.difficulty === difficulty)
    );

    const area = document.querySelector('#storyArea');

    area.innerHTML = visible.length
      ? visible.map(s => `
          <article class="card">
            <h2>${esc(s.title)}</h2>

            <p>${esc(s.description)}</p>

            <span class="tag">
              ${s.minPlayers}–${s.maxPlayers} joueurs
            </span>

            <span class="tag">
              ${esc(s.difficulty)}
            </span>

            <span class="tag">
              ${esc(s.duration)}
            </span>

            <div class="divider"></div>

            <button data-id="${esc(s.id)}">
              Lancer cette enquête
            </button>
          </article>
        `).join('')
      : `
        <section class="card">
          <p>Aucun dossier ne correspond à ces filtres.</p>
        </section>
      `;

    document.querySelectorAll('[data-id]').forEach(button => {
      button.onclick = async () => {
        const result = await emit('story:select', {
          code: room.code,
          storyId: button.dataset.id
        });

        if (result.error) {
          const error = document.querySelector('#error');

          if (error) {
            error.textContent = result.error;
          }
        }
      };
    });
  };

  shell(`
    <p class="eyebrow">${esc(room.code)} · Étape 2</p>

    <h1 class="brand">Les dossiers</h1>

    <section class="card">
      <h2>Trouver une enquête</h2>

      <div class="row">
        <select id="filterPlayers">
          <option value="3">3 joueurs</option>
          <option value="4">4 joueurs</option>
          <option value="5">5 joueurs</option>
          <option value="6">6 joueurs</option>
        </select>

        <select id="filterDifficulty">
          <option value="all">Toutes difficultés</option>
          <option>Accessible</option>
          <option>Intermédiaire</option>
          <option>Difficile</option>
          <option>Expert</option>
        </select>
      </div>

      <p class="small">
        Le filtre utilise ${room.players.length}
        joueur${room.players.length > 1 ? 's' : ''}
        actuellement dans le salon ; vous pouvez aussi explorer les autres formats.
      </p>
    </section>

    <div id="storyArea" class="stories"></div>

    <p id="error" class="error"></p>
  `);

  document.querySelector('#filterPlayers').value =
    String(room.players.length);

  document.querySelector('#filterPlayers').onchange = draw;
  document.querySelector('#filterDifficulty').onchange = draw;

  draw();
}

async function sheet() {
  const data = await emit('sheet:get', {
    code: room.code
  });

  if (data.error) {
    return;
  }

  const c = data.character;

  const list = array => `
    <ul>
      ${array.map(x => `<li>${esc(x)}</li>`).join('')}
    </ul>
  `;

  const evidence = data.caseFile.evidence
    ? `
      <section class="card">
        <div class="fact">
          <strong>Éléments accessibles à tous</strong>
          ${list(data.caseFile.evidence)}
        </div>
      </section>
    `
    : '';

  shell(`
    <p class="eyebrow">
      Dossier confidentiel · ${esc(room.code)}
    </p>

    <section class="sheet-header">
      <span class="tag">${esc(c.profession)}</span>
      <span class="tag">${esc(c.isCulprit ? 'Coupable' : c.isSuspect ? 'Suspect' : 'Témoin')}</span>

      <h1>${esc(c.identity)}</h1>

      <p>${esc(c.personality)}</p>
    </section>

    <div class="notice">
      ${esc(data.caseFile.opening)}
    </div>

    ${c.privateClue ? `
      <section class="card">
        <div class="fact">
          <strong>Indice privé</strong>
          ${esc(c.privateClue)}
        </div>
      </section>
    ` : ''}

    ${evidence}

    <section class="card">
      <div class="fact">
        <strong>Vos relations</strong>
        ${esc(c.relations)}
      </div>

      <div class="fact">
        <strong>Emploi du temps détaillé</strong>
        ${list(c.schedule)}
      </div>

      <div class="fact">
        <strong>Objectifs personnels</strong>
        ${list(c.objectives)}
      </div>
    </section>

    <section class="card">
      <div class="fact">
        <strong>
          Vos secrets — ne montrez pas cette section
        </strong>

        ${list(c.secrets)}
      </div>

      <div class="fact">
        <strong>Objets en votre possession</strong>
        ${list(c.items)}
      </div>

      <div class="fact">
        <strong>Ce que vous savez</strong>
        ${list(c.knows)}
      </div>

      <div class="fact">
        <strong>Ce que vous ignorez</strong>
        ${list(c.ignores)}
      </div>

      <div class="fact">
        <strong>Vos soupçons</strong>
        ${esc(c.suspicions)}
      </div>
    </section>

    ${room.accusationOpen ? accuse() : ''}

    ${room.voteClosed ? voteResults() : ''}
    
    ${

        room.hostId === socket.id
        ? `
        <button
        class="secondary"
        id="open"
        ${room.accusationOpen ? 'disabled' : ''}
        >
        Ouvrir les accusations
        </button>
        
        <button
        class="secondary"
        id="reveal"
        >
        Révéler la vérité
        </button>
        `
        : ''
    }

    ${solution ? solutionBlock() : ''}

    <p id="error" class="error"></p>
  `);

  const open = document.querySelector('#open');

  if (open) {
    open.onclick = async () => {
      await emit('accusation:open', {
        code: room.code
      });
    };
  }

  const reveal = document.querySelector('#reveal');

  if (reveal) {
    reveal.onclick = async () => {
      await emit('solution:reveal', {
        code: room.code
      });
    };
  }
}

function accuse() {
  if (room.hasVoted) {
    return `
      <section class="card">
        <h2>Vote enregistré</h2>

        <p>
          Votre bulletin est scellé.
          Attendez les autres enquêteurs :
          ${room.voteProgress.submitted} /
          ${room.voteProgress.total}
          votes reçus.
        </p>
      </section>
    `;
  }

  const suspects = room.players
    .map(p => `
      <option value="${esc(p.characterId)}">
        ${esc(p.characterName || 'Personnage inconnu')}
      </option>
    `)
    .join('');

  return `
    <section class="card">
      <h2>Accusation finale</h2>

      <p class="small">
        Votre bulletin reste secret jusqu’au dernier vote.
        Votez pour un personnage, jamais pour un pseudo.
      </p>

      <select id="suspect">
        ${suspects}
      </select>

      <textarea
        id="motive"
        placeholder="Pourquoi cette personne ? Quels indices vous convainquent ?"
      ></textarea>

      <button id="accuse">
        Sceller mon bulletin
      </button>

      <p class="small">
        ${room.voteProgress.submitted} /
        ${room.voteProgress.total}
        votes reçus.
      </p>
    </section>
  `;
}

function voteResults() {
  const eliminated = room.elimination.eliminated.join(' et ');

  const label =
    room.elimination.eliminated.length > 1
      ? 'Égalité : les personnages éliminés sont'
      : 'Personnage éliminé';

  return `
    <section class="card solution">
      <p class="eyebrow">
        Vote clos — tous les bulletins sont reçus
      </p>

      <h2>
        ${label} : ${esc(eliminated)}
      </h2>

      <p>
        ${room.elimination.highest}
        vote${room.elimination.highest > 1 ? 's' : ''}
        au maximum.
        Son rôle reste secret jusqu’à la révélation de la vérité.
      </p>

      <div class="divider"></div>

      <h2>Les accusations</h2>

      ${room.accusations
        .map(v => `
          <p>
            ${esc(v.voterName)}
            accuse
            ${esc(v.suspectName)}
            — ${esc(v.motive || 'Aucun motif communiqué.')}
          </p>
        `)
        .join('')}
    </section>
  `;
}

function solutionBlock() {
  const text = solution?.explanation || '';
  const m = text.match(/([\s\S]*?)(\bLe coupable est\b[\s\S]*)/);
  const first = m ? m[1].trim() : text.trim();
  const second = m ? m[2].trim() : '';

  return `
    <section class="card solution">
      <p class="eyebrow">Dossier clos</p>

      <p>${esc(first)}</p>
      ${second ? `<p>${esc(second)}</p>` : ''}
    </section>
  `;
}

function render() {
  if (!room) {
    welcome();
    return;
  }

  if (room.phase === 'lobby') {
    lobby();
    return;
  }

  sheet().then(() => {
    const button = document.querySelector('#accuse');

    if (button) {
      button.onclick = async () => {
        const suspect = document.querySelector('#suspect');
        const motive = document.querySelector('#motive');

        await emit('accusation:submit', {
          code: room.code,
          suspectId: suspect.value,
          motive: motive.value
        });
      };
    }
  });
}

socket.on('room:update', updatedRoom => {
  room = updatedRoom;

  if (state) {
    state.code = room.code;
    state.playerId = socket.id;
    save();
  }

  render();
});

socket.on('solution:show', data => {
  solution = data;
  render();
});

socket.on('connect', async () => {
  if (!state || !state.code) {
    welcome();
    return;
  }

  const result = await emit('room:join', {
    code: state.code,
    name: state.name || ''
  });

  if (result.error) {
    state = null;
    room = null;
    solution = null;
    localStorage.removeItem('nocturne-session');
    welcome();
    return;
  }

  room = result.room;

  state = {
    code: room.code,
    playerId: result.playerId,
    token: result.token || deviceToken,
    name: result.name || state.name || ''
  };

  save();
  render();
});