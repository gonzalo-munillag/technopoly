const socket = io();

let myRole = null;
let myPlayerId = null;
let myName = null;

// ── DOM refs ────────────────────────────────────────────────
const loginScreen  = document.getElementById("login-screen");
const lobbyScreen  = document.getElementById("lobby-screen");
const gameScreen   = document.getElementById("game-screen");

const playerNameIn = document.getElementById("player-name");
const passwordIn   = document.getElementById("password");
const loginBtn     = document.getElementById("login-btn");
const loginError   = document.getElementById("login-error");

const playerList   = document.getElementById("player-list");
const startGameBtn = document.getElementById("start-game-btn");
const lobbyError   = document.getElementById("lobby-error");

const genBadge     = document.getElementById("gen-badge");
const deckBadge    = document.getElementById("deck-badge");
const turnBadge    = document.getElementById("turn-badge");
const resourcesDiv = document.getElementById("resources-panel");
const productionDiv = document.getElementById("production-panel");
const playedDiv    = document.getElementById("played-cards");
const handDiv      = document.getElementById("hand-container");
const drawBtn      = document.getElementById("draw-btn");
const endTurnBtn   = document.getElementById("end-turn-btn");
const gameError    = document.getElementById("game-error");

// ── Screen switching ────────────────────────────────────────
function showScreen(screen) {
  [loginScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

// ── Login ───────────────────────────────────────────────────
loginBtn.addEventListener("click", () => {
  const name = playerNameIn.value.trim();
  const password = passwordIn.value;
  if (!name) { loginError.textContent = "Enter your name."; return; }
  socket.emit("login", { name, password });
});

passwordIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

socket.on("login_success", (data) => {
  myRole = data.role;
  myPlayerId = data.player_id;
  myName = data.name;
  loginError.textContent = "";
  showScreen(lobbyScreen);
  if (myRole === "master") {
    startGameBtn.classList.remove("hidden");
  }
});

socket.on("login_error", (data) => {
  loginError.textContent = data.message;
});

// ── Lobby ───────────────────────────────────────────────────
socket.on("lobby_update", (data) => {
  playerList.innerHTML = "";
  data.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.player_id === myPlayerId ? " (you)" : "");
    playerList.appendChild(li);
  });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("start_game");
});

socket.on("error", (data) => {
  if (lobbyScreen.classList.contains("active")) {
    lobbyError.textContent = data.message;
  } else {
    showFloatingError(data.message);
  }
});

// ── Game ────────────────────────────────────────────────────
socket.on("game_started", (state) => {
  showScreen(gameScreen);
  renderGameState(state);
});

socket.on("game_state", (state) => {
  renderGameState(state);
});

socket.on("your_hand", (data) => {
  renderHand(data.hand);
  renderResources(data.resources);
  renderProduction(data.production);
});

function renderGameState(state) {
  genBadge.textContent = `Gen ${state.generation}`;
  deckBadge.textContent = `Deck: ${state.deck_remaining}`;

  const currentPlayer = state.players[state.current_player_id];
  const isMyTurn = state.current_player_id === myPlayerId;
  turnBadge.textContent = isMyTurn ? "Your Turn!" : `Turn: ${currentPlayer?.name || "..."}`;
  turnBadge.style.background = isMyTurn ? "var(--accent)" : "var(--primary)";

  drawBtn.disabled = !isMyTurn;
  endTurnBtn.disabled = !isMyTurn;

  // Render played cards from own player data
  const me = state.players[myPlayerId];
  if (me) {
    playedDiv.innerHTML = "";
    me.played_cards.forEach(c => {
      const div = document.createElement("div");
      div.className = "played-mini";
      div.textContent = c.name;
      playedDiv.appendChild(div);
    });
  }
}

function renderHand(hand) {
  handDiv.innerHTML = "";
  hand.forEach(card => {
    const el = document.createElement("div");
    el.className = "game-card";
    const prodText = Object.entries(card.production || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${v} ${k}`)
      .join(", ");
    el.innerHTML = `
      <div class="card-cost">${card.cost}</div>
      <div class="card-name">${card.name}</div>
      <span class="card-tag">${card.tag}</span>
      <span class="card-type">${card.card_type}</span>
      <p class="card-desc">${card.description}</p>
      ${prodText ? `<div class="card-production">${prodText}</div>` : ""}
    `;
    el.addEventListener("click", () => {
      socket.emit("play_card", { card_name: card.name });
    });
    handDiv.appendChild(el);
  });
}

function renderResources(resources) {
  resourcesDiv.innerHTML = "";
  Object.entries(resources).forEach(([key, val]) => {
    const div = document.createElement("div");
    div.className = "resource-item";
    div.innerHTML = `<span class="label">${key}</span><span class="value">${val}</span>`;
    resourcesDiv.appendChild(div);
  });
}

function renderProduction(production) {
  productionDiv.innerHTML = "";
  Object.entries(production).forEach(([key, val]) => {
    const div = document.createElement("div");
    div.className = "resource-item";
    div.innerHTML = `<span class="label">${key}</span><span class="value">+${val}</span>`;
    productionDiv.appendChild(div);
  });
}

// ── Actions ─────────────────────────────────────────────────
drawBtn.addEventListener("click", () => socket.emit("draw_card"));
endTurnBtn.addEventListener("click", () => socket.emit("end_turn"));

// ── Error toast ─────────────────────────────────────────────
function showFloatingError(msg) {
  gameError.textContent = msg;
  gameError.classList.add("visible");
  setTimeout(() => gameError.classList.remove("visible"), 3000);
}
