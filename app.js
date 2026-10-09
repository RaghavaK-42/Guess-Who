import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCThs0rPT_Qp3LHs3UOCODOV329Jnn-n9c",
  authDomain: "guesswho-ba1af.firebaseapp.com",
  databaseURL: "https://guesswho-ba1af-default-rtdb.firebaseio.com/",
  projectId: "guesswho-ba1af",
  storageBucket: "guesswho-ba1af.firebasestorage.app",
  messagingSenderId: "514771209120",
  appId: "1:514771209120:web:628ea361a61750d75bb2c5",
  measurementId: "G-405Q0FT5R1",
};

const ADMIN_CODE = "Sethupathi";
const PLAYER_ID_KEY = "guesswho-player-id";
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

const joinView = document.querySelector("#join-view");
const gameView = document.querySelector("#game-view");
const joinForm = document.querySelector("#join-form");
const joinMessage = document.querySelector("#join-message");
const gameMessage = document.querySelector("#game-message");
const playerList = document.querySelector("#player-list");
const roomLabel = document.querySelector("#room-label");
const categoryLabel = document.querySelector("#category-label");
const newGameButton = document.querySelector("#new-game-button");
const leaveRoomButton = document.querySelector("#leave-room-button");
const scrapGameButton = document.querySelector("#scrap-game-button");
const adminPanel = document.querySelector("#admin-panel");
const playerTemplate = document.querySelector("#player-template");

let charactersByCategory = {};
let activeRoomCode = "";
let activePlayerId = "";
let isAdmin = false;
let players = {};
let currentGame = null;
let isStartingGame = false;
let isScrappingRoom = false;
let stopRoomListener = null;
let stopPlayersListener = null;
let stopGameListener = null;
const pendingVotes = new Set();

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error-message", isError);
  element.hidden = !message;
}

function getPlayerId() {
  const storedId = localStorage.getItem(PLAYER_ID_KEY);
  if (storedId) return storedId;

  const newId = crypto.randomUUID();
  localStorage.setItem(PLAYER_ID_KEY, newId);
  return newId;
}

function cleanRoomCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
}

function disconnectRoom() {
  if (stopRoomListener) stopRoomListener();
  if (stopPlayersListener) stopPlayersListener();
  if (stopGameListener) stopGameListener();
  stopRoomListener = null;
  stopPlayersListener = null;
  stopGameListener = null;
  activeRoomCode = "";
  players = {};
  currentGame = null;
  isAdmin = false;
  isScrappingRoom = false;
  pendingVotes.clear();
}

function roomRef(...parts) {
  const roomPath = `rooms/${activeRoomCode}`;
  return ref(database, parts.length > 0 ? `${roomPath}/${parts.join("/")}` : roomPath);
}

function returnToJoin(message) {
  disconnectRoom();
  gameView.hidden = true;
  joinView.hidden = false;
  joinForm.reset();
  joinForm.elements.roomCode.focus();
  setMessage(gameMessage, "");
  setMessage(joinMessage, message);
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function displayPlayerList() {
  playerList.replaceChildren();
  const gameIsActive = Boolean(currentGame?.category && currentGame?.assignments);

  Object.entries(players)
    .sort(([, first], [, second]) => String(first.name).localeCompare(String(second.name)))
    .forEach(([playerId, player]) => {
      const card = playerTemplate.content.firstElementChild.cloneNode(true);
      const name = card.querySelector(".player-name");
      const role = card.querySelector(".player-role");
      const score = card.querySelector(".player-score");
      const character = card.querySelector(".player-character");
      const voteStatus = card.querySelector(".vote-status");
      const controls = card.querySelector(".player-controls");
      const isSelf = playerId === activePlayerId;
      const assignment = currentGame?.assignments?.[playerId];

      name.textContent = player.name || "Player";
      role.textContent = player.isAdmin ? "Admin" : "Player";
      role.hidden = !player.isAdmin;
      score.textContent = `${Number(player.score) || 0} points`;
      card.classList.toggle("is-you", isSelf);

      if (gameIsActive && assignment?.character) {
        if (isSelf) {
          character.textContent = "Your character is hidden from you";
          character.classList.add("hidden-character");
        } else {
          character.textContent = assignment.character;
          character.classList.remove("hidden-character");
        }

        if (!isSelf) {
          const eligibleVoters = Math.max(0, Object.keys(currentGame.assignments).length - 1);
          const requiredVotes = Math.floor(eligibleVoters / 2) + 1;
          const voteCount = Object.keys(assignment.votes || {}).filter(
            (voterId) =>
              voterId !== playerId &&
              voterId in currentGame.assignments &&
              assignment.votes[voterId],
          ).length;
          voteStatus.textContent = `${voteCount}/${requiredVotes} change votes`;

          const voteButton = document.createElement("button");
          voteButton.type = "button";
          voteButton.className = "button button-secondary button-small";
          voteButton.textContent = assignment.votes?.[activePlayerId]
            ? "Remove my vote"
            : "Vote to change";
          voteButton.disabled =
            !gameIsActive ||
            eligibleVoters === 0 ||
            pendingVotes.has(playerId) ||
            !(activePlayerId in currentGame.assignments);
          voteButton.addEventListener("click", () => toggleVote(playerId));
          controls.append(voteButton);
        } else {
          voteStatus.textContent = "Only other players can see your character";
        }
      } else {
        character.textContent = gameIsActive ? "Assignment unavailable" : "Waiting for a new game";
        character.classList.remove("hidden-character");
        voteStatus.textContent = "";
      }

      if (isAdmin) {
        const minusButton = document.createElement("button");
        minusButton.type = "button";
        minusButton.className = "button button-quiet button-small";
        minusButton.textContent = "−";
        minusButton.setAttribute("aria-label", `Remove a point from ${player.name}`);
        minusButton.addEventListener("click", () => adjustScore(playerId, -1));

        const plusButton = document.createElement("button");
        plusButton.type = "button";
        plusButton.className = "button button-quiet button-small";
        plusButton.textContent = "+";
        plusButton.setAttribute("aria-label", `Add a point to ${player.name}`);
        plusButton.addEventListener("click", () => adjustScore(playerId, 1));
        controls.append(minusButton, plusButton);
      }

      playerList.append(card);
    });

  adminPanel.hidden = !isAdmin;
  newGameButton.disabled =
    isStartingGame ||
    isScrappingRoom ||
    Object.keys(players).length === 0 ||
    !Object.values(charactersByCategory).some((characters) => characters.length > 0);
  scrapGameButton.disabled = isScrappingRoom;
}

async function addMissingAssignments() {
  if (!isAdmin || !currentGame?.category || !charactersByCategory[currentGame.category]) return;

  const missingPlayerIds = Object.keys(players).filter(
    (playerId) => !currentGame.assignments?.[playerId],
  );
  if (missingPlayerIds.length === 0) return;

  const categoryCharacters = charactersByCategory[currentGame.category];
  const gameReference = roomRef("game");
  await runTransaction(gameReference, (game) => {
    if (!game?.category || !game.assignments) return game;

    const assignments = { ...game.assignments };
    let availableCharacters = shuffled(categoryCharacters);
    for (const playerId of Object.keys(players)) {
      if (assignments[playerId]?.character) {
        availableCharacters = availableCharacters.filter(
          (character) => character !== assignments[playerId].character,
        );
      }
    }

    for (const playerId of missingPlayerIds) {
      if (assignments[playerId]) continue;
      const character =
        availableCharacters.length > 0
          ? availableCharacters.pop()
          : randomItem(categoryCharacters);
      assignments[playerId] = { character, votes: {} };
    }

    return { ...game, assignments };
  });
}

function watchRoom() {
  const roomCode = activeRoomCode;
  stopRoomListener = onValue(
    roomRef(),
    (snapshot) => {
      if (!snapshot.exists() && activeRoomCode === roomCode) {
        returnToJoin("This room was scrapped. Enter a new room code to continue.");
      }
    },
    (error) => {
      setMessage(gameMessage, `Could not monitor the room: ${error.message}`, true);
    },
  );

  stopPlayersListener = onValue(
    roomRef("players"),
    (snapshot) => {
      players = snapshot.val() || {};
      displayPlayerList();
      addMissingAssignments().catch((error) => {
        setMessage(gameMessage, `Could not assign a character to a new player: ${error.message}`, true);
      });
    },
    (error) => {
      setMessage(gameMessage, `Could not read this room's players: ${error.message}`, true);
    },
  );

  stopGameListener = onValue(
    roomRef("game"),
    (snapshot) => {
      currentGame = snapshot.val();
      categoryLabel.textContent = currentGame?.category || "Waiting for the admin to start a game";
      displayPlayerList();
    },
    (error) => {
      setMessage(gameMessage, `Could not read the game: ${error.message}`, true);
    },
  );
}

async function joinRoom(event) {
  event.preventDefault();
  setMessage(joinMessage, "");

  const formData = new FormData(joinForm);
  const roomCode = cleanRoomCode(String(formData.get("roomCode") || ""));
  const playerName = String(formData.get("playerName") || "").trim();
  const enteredAdminCode = String(formData.get("adminCode") || "");

  if (roomCode.length < 3) {
    setMessage(joinMessage, "Room codes must contain at least 3 letters or numbers.", true);
    return;
  }
  if (playerName.length < 2 || playerName.length > 30) {
    setMessage(joinMessage, "Enter a name between 2 and 30 characters.", true);
    return;
  }

  activeRoomCode = roomCode;
  activePlayerId = getPlayerId();
  isAdmin = enteredAdminCode === ADMIN_CODE;
  const playerReference = roomRef("players", activePlayerId);

  try {
    const transaction = await runTransaction(playerReference, (existingPlayer) => ({
      name: playerName,
      score: Number(existingPlayer?.score) || 0,
      isAdmin: Boolean(existingPlayer?.isAdmin || isAdmin),
    }));
    isAdmin = Boolean(transaction.snapshot.val()?.isAdmin);

    joinView.hidden = true;
    gameView.hidden = false;
    roomLabel.textContent = roomCode;
    categoryLabel.textContent = "Connecting to room…";
    setMessage(gameMessage, "");
    watchRoom();
  } catch (error) {
    activeRoomCode = "";
    setMessage(
      joinMessage,
      `Could not join room ${roomCode}. Check Firebase Realtime Database rules and connection. ${error.message}`,
      true,
    );
  }
}

async function startNewGame() {
  if (!isAdmin) return;

  const playerIds = Object.keys(players);
  if (playerIds.length === 0) {
    setMessage(gameMessage, "At least one player must join before starting a game.", true);
    return;
  }

  const categories = Object.keys(charactersByCategory).filter(
    (category) => charactersByCategory[category].length > 0,
  );
  if (categories.length === 0) {
    setMessage(gameMessage, "No categories with characters are available.", true);
    return;
  }

  const category = randomItem(categories);
  const categoryCharacters = shuffled(charactersByCategory[category]);
  const assignments = {};
  playerIds.forEach((playerId, index) => {
    assignments[playerId] = {
      character: categoryCharacters[index % categoryCharacters.length],
      votes: {},
    };
  });

  isStartingGame = true;
  displayPlayerList();
  setMessage(gameMessage, "");
  try {
    await set(roomRef("game"), {
      category,
      assignments,
      roundId: crypto.randomUUID(),
      startedAt: Date.now(),
    });
  } catch (error) {
    setMessage(gameMessage, `Could not start a new game: ${error.message}`, true);
  } finally {
    isStartingGame = false;
    displayPlayerList();
  }
}

async function scrapGame() {
  if (!isAdmin || isScrappingRoom) return;

  const confirmed = window.confirm(
    `Scrap room ${activeRoomCode}? This permanently removes the room and boots every player.`,
  );
  if (!confirmed) return;

  isScrappingRoom = true;
  displayPlayerList();
  setMessage(gameMessage, "");
  try {
    await remove(roomRef());
    if (activeRoomCode) {
      returnToJoin("Room scrapped. Enter a new room code to start again.");
    }
  } catch (error) {
    isScrappingRoom = false;
    displayPlayerList();
    setMessage(gameMessage, `Could not scrap the room: ${error.message}`, true);
  }
}

async function toggleVote(targetPlayerId) {
  if (
    !currentGame?.category ||
    targetPlayerId === activePlayerId ||
    !(activePlayerId in (currentGame.assignments || {}))
  ) {
    return;
  }

  pendingVotes.add(targetPlayerId);
  displayPlayerList();
  try {
    await runTransaction(roomRef("game"), (game) => {
      if (
        !game?.category ||
        !game.assignments?.[targetPlayerId] ||
        !game.assignments?.[activePlayerId] ||
        targetPlayerId === activePlayerId
      ) {
        return;
      }

      const assignments = { ...game.assignments };
      const target = { ...assignments[targetPlayerId] };
      const votes = { ...(target.votes || {}) };
      if (votes[activePlayerId]) {
        delete votes[activePlayerId];
      } else {
        votes[activePlayerId] = true;
      }

      const eligibleVoters = Math.max(0, Object.keys(assignments).length - 1);
      const requiredVotes = Math.floor(eligibleVoters / 2) + 1;
      const validVoteCount = Object.keys(votes).filter(
        (voterId) => voterId !== targetPlayerId && voterId in assignments && votes[voterId],
      ).length;

      if (eligibleVoters > 0 && validVoteCount >= requiredVotes) {
        const categoryCharacters = charactersByCategory[game.category] || [];
        const otherAssignments = Object.entries(assignments)
          .filter(([playerId]) => playerId !== targetPlayerId)
          .map(([, assignment]) => assignment.character);
        const replacements = categoryCharacters.filter(
          (character) =>
            character !== target.character && !otherAssignments.includes(character),
        );
        const fallbackCharacters = categoryCharacters.filter(
          (character) => character !== target.character,
        );
        if (fallbackCharacters.length > 0) {
          target.character = randomItem(replacements.length > 0 ? replacements : fallbackCharacters);
          target.votes = {};
          assignments[targetPlayerId] = target;
          return { ...game, assignments };
        }
      }

      target.votes = votes;
      assignments[targetPlayerId] = target;
      return { ...game, assignments };
    });
  } catch (error) {
    setMessage(gameMessage, `Could not submit your vote: ${error.message}`, true);
  } finally {
    pendingVotes.delete(targetPlayerId);
    displayPlayerList();
  }
}

async function adjustScore(playerId, amount) {
  if (!isAdmin) return;

  try {
    await runTransaction(roomRef("players", playerId), (player) => {
      if (!player) return;
      return { ...player, score: (Number(player.score) || 0) + amount };
    });
  } catch (error) {
    setMessage(gameMessage, `Could not update the score: ${error.message}`, true);
  }
}

joinForm.addEventListener("submit", joinRoom);
newGameButton.addEventListener("click", startNewGame);
scrapGameButton.addEventListener("click", scrapGame);
leaveRoomButton.addEventListener("click", () => {
  returnToJoin("");
});

fetch("./characters.json")
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Character data request failed (${response.status}).`);
    }
    return response.json();
  })
  .then((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Character data must be a category-to-characters JSON object.");
    }
    charactersByCategory = Object.fromEntries(
      Object.entries(data).filter(
        ([category, characters]) =>
          typeof category === "string" &&
          Array.isArray(characters) &&
          characters.every((character) => typeof character === "string"),
      ),
    );
    displayPlayerList();
  })
  .catch((error) => {
    displayPlayerList();
    const message = `Could not load characters.json: ${error.message}`;
    setMessage(joinMessage, message, true);
    setMessage(gameMessage, message, true);
  });
