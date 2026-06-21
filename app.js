const SIZE = 8;
const RED = 'red';
const CREAM = 'cream';

const boardEl = document.getElementById('board');
const turnBanner = document.getElementById('turnBanner');
const turnText = document.getElementById('turnText');
const turnHint = document.getElementById('turnHint');
const redPlayer = document.getElementById('redPlayer');
const creamPlayer = document.getElementById('creamPlayer');
const scoreCard = document.querySelector('.score-card');
const redCount = document.getElementById('redCount');
const creamCount = document.getElementById('creamCount');
const redLabel = document.getElementById('redLabel');
const creamLabel = document.getElementById('creamLabel');
const difficultyField = document.getElementById('difficultyField');
const difficultySelect = document.getElementById('difficultySelect');
const undoButton = document.getElementById('undoButton');
const hintButton = document.getElementById('hintButton');
const newGameButton = document.getElementById('newGameButton');
const moveCounter = document.getElementById('moveCounter');
const gameOver = document.getElementById('gameOver');
const playAgainButton = document.getElementById('playAgainButton');
const resultTitle = document.getElementById('resultTitle');
const resultCopy = document.getElementById('resultCopy');
const soundButton = document.getElementById('soundButton');
const toastEl = document.getElementById('toast');
const introScreen = document.getElementById('introScreen');

let state;
let selected = null;
let candidates = [];
let turnSnapshot = null;
let history = [];
let aiThinking = false;
let moveAnimating = false;
let lastMove = [];
let hintSquare = null;
let toastTimer;
let introDismissed = false;

function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;
  introScreen.classList.add('out');
  document.body.classList.remove('intro-open');
  setTimeout(() => { introScreen.hidden = true; }, 520);
}

function initialBoard() {
  return Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => {
      if ((row + col) % 2 === 0) return null;
      if (row < 3) return { color: CREAM, king: false };
      if (row > 4) return { color: RED, king: false };
      return null;
    })
  );
}

function newState() {
  return {
    board: initialBoard(),
    turn: RED,
    mode: state?.mode || 'ai',
    difficulty: difficultySelect.value,
    humanColor: state?.humanColor || RED,
    moveNumber: 1,
    sound: state?.sound ?? true,
    winner: null,
  };
}

function cloneBoard(board) {
  return board.map(row => row.map(piece => piece ? { ...piece } : null));
}

function cloneState(value = state) {
  return { ...value, board: cloneBoard(value.board) };
}

function key(pos) { return `${pos.r},${pos.c}`; }
function inside(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
function opponent(color) { return color === RED ? CREAM : RED; }
function aiColor() { return opponent(state.humanColor); }
function isAITurn() { return state.mode === 'ai' && state.turn === aiColor(); }
function samePos(a, b) { return a && b && a.r === b.r && a.c === b.c; }

function directions(piece) {
  if (piece.king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const forward = piece.color === RED ? -1 : 1;
  return [[forward, -1], [forward, 1]];
}

function captureSequences(board, from, piece) {
  const results = [];

  function search(currentBoard, position, steps) {
    let extended = false;
    for (const [dr, dc] of directions(piece)) {
      const middle = { r: position.r + dr, c: position.c + dc };
      const landing = { r: position.r + dr * 2, c: position.c + dc * 2 };
      if (!inside(landing.r, landing.c)) continue;
      const jumped = currentBoard[middle.r][middle.c];
      if (!jumped || jumped.color === piece.color || currentBoard[landing.r][landing.c]) continue;
      // Nella dama italiana una pedina semplice non può catturare una dama.
      if (!piece.king && jumped.king) continue;

      extended = true;
      const nextBoard = cloneBoard(currentBoard);
      nextBoard[position.r][position.c] = null;
      nextBoard[middle.r][middle.c] = null;
      nextBoard[landing.r][landing.c] = { ...piece };
      search(nextBoard, landing, [...steps, { to: landing, captured: middle, capturedKing: jumped.king }]);
    }
    if (!extended && steps.length) results.push({ from, steps });
  }

  search(board, from, []);
  return results;
}

function getLegalMoves(board, color) {
  const captures = [];
  const simple = [];

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      const from = { r, c };
      captures.push(...captureSequences(board, from, piece));
      for (const [dr, dc] of directions(piece)) {
        const to = { r: r + dr, c: c + dc };
        if (inside(to.r, to.c) && !board[to.r][to.c]) simple.push({ from, steps: [{ to, captured: null, capturedKing: false }] });
      }
    }
  }

  if (!captures.length) return simple;
  const maxCaptures = Math.max(...captures.map(move => move.steps.length));
  let best = captures.filter(move => move.steps.length === maxCaptures);
  const hasKingCapture = best.some(move => board[move.from.r][move.from.c]?.king);
  if (hasKingCapture) best = best.filter(move => board[move.from.r][move.from.c]?.king);
  const maxKings = Math.max(...best.map(move => move.steps.filter(step => step.capturedKing).length));
  best = best.filter(move => move.steps.filter(step => step.capturedKing).length === maxKings);
  // A ulteriore parità, ha precedenza la sequenza che incontra prima una dama.
  const firstKing = move => {
    const index = move.steps.findIndex(step => step.capturedKing);
    return index === -1 ? Infinity : index;
  };
  const earliestKing = Math.min(...best.map(firstKing));
  return best.filter(move => firstKing(move) === earliestKing);
}

function applyCompleteMove(board, move, color) {
  const next = cloneBoard(board);
  let piece = next[move.from.r][move.from.c];
  let current = move.from;
  for (const step of move.steps) {
    next[current.r][current.c] = null;
    if (step.captured) next[step.captured.r][step.captured.c] = null;
    next[step.to.r][step.to.c] = piece;
    current = step.to;
  }
  if (!piece.king && ((color === RED && current.r === 0) || (color === CREAM && current.r === 7))) piece.king = true;
  return next;
}

function getSquareElement(position) {
  return boardEl.querySelector(`[data-row="${position.r}"][data-col="${position.c}"]`);
}

async function animateStep(from, to, captured = null) {
  const sourceSquare = getSquareElement(from);
  const targetSquare = getSquareElement(to);
  const sourcePiece = sourceSquare?.querySelector('.piece');
  if (!sourcePiece || !targetSquare) return;

  const start = sourcePiece.getBoundingClientRect();
  const target = targetSquare.getBoundingClientRect();
  const ghost = sourcePiece.cloneNode(true);
  ghost.classList.add('move-ghost');
  if (boardEl.classList.contains('flipped')) ghost.classList.add('flipped-ghost');
  Object.assign(ghost.style, {
    left: `${start.left}px`,
    top: `${start.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
  });

  document.body.appendChild(ghost);
  sourcePiece.style.opacity = '0';
  boardEl.dataset.animating = 'true';
  boardEl.dispatchEvent(new CustomEvent('dama:animationstart', { detail: { from, to, captured } }));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reducedMotion ? 1 : 450;
  const destinationX = target.left + (target.width - start.width) / 2;
  const destinationY = target.top + (target.height - start.height) / 2;
  const animations = [ghost.animate([
    { transform: 'translate3d(0, 0, 0) scale(1)' },
    { transform: `translate3d(${destinationX - start.left}px, ${destinationY - start.top}px, 0) scale(1.04)`, offset: .72 },
    { transform: `translate3d(${destinationX - start.left}px, ${destinationY - start.top}px, 0) scale(1)` },
  ], { duration, easing: 'cubic-bezier(.22,.78,.24,1)', fill: 'forwards' })];

  if (captured) {
    const capturedPiece = getSquareElement(captured)?.querySelector('.piece');
    if (capturedPiece) {
      animations.push(capturedPiece.animate([
        { opacity: 1, transform: 'scale(1)', offset: 0 },
        { opacity: 1, transform: 'scale(1)', offset: .35 },
        { opacity: 0, transform: 'scale(.42)', offset: 1 },
      ], { duration, easing: 'ease-in', fill: 'forwards' }));
    }
  }

  await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  ghost.remove();
  delete boardEl.dataset.animating;
  boardEl.dispatchEvent(new CustomEvent('dama:animationend', { detail: { from, to, captured } }));
}

function finishTurn(finalPosition, movedPiece) {
  if (!movedPiece.king && ((movedPiece.color === RED && finalPosition.r === 0) || (movedPiece.color === CREAM && finalPosition.r === 7))) {
    movedPiece.king = true;
    sound('king');
    showToast('Promozione! È una dama.');
  }
  if (turnSnapshot) history.push(turnSnapshot);
  state.turn = opponent(state.turn);
  if (state.turn === RED) state.moveNumber++;
  selected = null;
  candidates = [];
  turnSnapshot = null;
  hintSquare = null;
  saveGame();
  checkGameEnd();
  render();
  if (!state.winner && isAITurn()) scheduleAI();
}

async function selectSquare(r, c) {
  if (state.winner || aiThinking || moveAnimating) return;
  if (isAITurn()) return;
  const pos = { r, c };
  const piece = state.board[r][c];

  if (selected) {
    const matching = candidates.filter(move => samePos(move.steps[0].to, pos));
    if (matching.length) {
      if (!turnSnapshot) turnSnapshot = cloneState();
      const step = matching[0].steps[0];
      const from = selected;
      const movingPiece = state.board[selected.r][selected.c];
      moveAnimating = true;
      sound(step.captured ? 'capture' : 'move');
      await animateStep(from, pos, step.captured);
      state.board[from.r][from.c] = null;
      if (step.captured) state.board[step.captured.r][step.captured.c] = null;
      state.board[pos.r][pos.c] = movingPiece;
      lastMove = [from, pos];
      moveAnimating = false;

      const remaining = matching.filter(move => move.steps.length > 1).map(move => ({ from: pos, steps: move.steps.slice(1) }));
      if (remaining.length) {
        selected = pos;
        candidates = remaining;
        turnHint.textContent = 'CONTINUA LA PRESA';
        render();
      } else {
        finishTurn(pos, movingPiece);
      }
      return;
    }
  }

  if (piece?.color === state.turn && !turnSnapshot) {
    const legal = getLegalMoves(state.board, state.turn);
    const forPiece = legal.filter(move => samePos(move.from, pos));
    if (forPiece.length) {
      selected = pos;
      candidates = forPiece;
      hintSquare = null;
      sound('select');
      render();
    } else {
      showToast(legal.some(move => move.steps[0].captured) ? 'La presa è obbligatoria.' : 'Questa pedina non può muoversi.');
    }
  }
}

function checkGameEnd() {
  const legal = getLegalMoves(state.board, state.turn);
  const pieceCount = state.board.flat().filter(piece => piece?.color === state.turn).length;
  if (!pieceCount || !legal.length) {
    state.winner = opponent(state.turn);
    saveGame();
    setTimeout(showGameOver, 250);
  }
}

function showGameOver() {
  const humanWon = state.winner === state.humanColor;
  const local = state.mode === 'local';
  resultTitle.textContent = local ? `${state.winner === RED ? 'Rosso' : 'Avorio'} vince!` : humanWon ? 'Hai vinto!' : 'Vince il computer';
  resultCopy.textContent = humanWon || local ? 'La corona premia chi vede più lontano.' : 'Questa volta ha calcolato una diagonale in più.';
  gameOver.hidden = false;
  sound(humanWon ? 'win' : 'lose');
}

function evaluate(board, maximizingColor) {
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p) continue;
      const value = p.king ? 5.2 : 3 + (p.color === CREAM ? r : 7 - r) * .08;
      const center = r > 1 && r < 6 && c > 1 && c < 6 ? .15 : 0;
      score += (p.color === maximizingColor ? 1 : -1) * (value + center);
    }
  }
  return score;
}

function minimax(board, color, depth, alpha, beta, maximizingColor) {
  const moves = getLegalMoves(board, color);
  if (!depth || !moves.length) return evaluate(board, maximizingColor) + (!moves.length ? (color === maximizingColor ? -100 : 100) : 0);
  if (color === maximizingColor) {
    let best = -Infinity;
    for (const move of moves) {
      best = Math.max(best, minimax(applyCompleteMove(board, move, color), opponent(color), depth - 1, alpha, beta, maximizingColor));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves) {
    best = Math.min(best, minimax(applyCompleteMove(board, move, color), opponent(color), depth - 1, alpha, beta, maximizingColor));
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseAIMove() {
  const computer = aiColor();
  const moves = getLegalMoves(state.board, computer);
  if (!moves.length) return null;
  if (state.difficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];
  const depth = state.difficulty === 'hard' ? 5 : 2;
  const scored = moves.map(move => ({ move, score: minimax(applyCompleteMove(state.board, move, computer), opponent(computer), depth - 1, -Infinity, Infinity, computer) + Math.random() * .03 }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].move;
}

function scheduleAI() {
  aiThinking = true;
  render();
  setTimeout(async () => {
    const move = chooseAIMove();
    if (!move) {
      aiThinking = false;
      checkGameEnd();
      render();
      return;
    }
    const before = cloneState();
    const computer = aiColor();
    const movingPiece = state.board[move.from.r][move.from.c];
    let current = move.from;
    moveAnimating = true;
    for (const step of move.steps) {
      sound(step.captured ? 'capture' : 'move');
      await animateStep(current, step.to, step.captured);
      state.board[current.r][current.c] = null;
      if (step.captured) state.board[step.captured.r][step.captured.c] = null;
      state.board[step.to.r][step.to.c] = movingPiece;
      lastMove = [current, step.to];
      current = step.to;
      render();
    }
    const finalPos = current;
    moveAnimating = false;
    lastMove = [move.from, finalPos];
    history.push(before);
    if (!movingPiece.king && ((computer === RED && finalPos.r === 0) || (computer === CREAM && finalPos.r === 7))) {
      movingPiece.king = true;
      sound('king');
    }
    state.turn = opponent(computer);
    if (state.turn === RED) state.moveNumber++;
    aiThinking = false;
    saveGame();
    checkGameEnd();
    render();
  }, 520);
}

function undo() {
  if (!history.length || aiThinking || moveAnimating) return;
  let previous = history.pop();
  if (state.mode === 'ai' && previous.turn === aiColor() && history.length) previous = history.pop();
  const preservedMode = state.mode;
  const preservedDifficulty = state.difficulty;
  state = previous;
  state.mode = preservedMode;
  state.difficulty = preservedDifficulty;
  state.winner = null;
  selected = null;
  candidates = [];
  turnSnapshot = null;
  lastMove = [];
  gameOver.hidden = true;
  saveGame();
  render();
}

function suggestMove() {
  if (aiThinking || moveAnimating || state.winner || isAITurn()) return;
  const moves = getLegalMoves(state.board, state.turn);
  if (!moves.length) return;
  const best = moves.map(move => ({ move, score: minimax(applyCompleteMove(state.board, move, state.turn), opponent(state.turn), 2, -Infinity, Infinity, state.turn) }))
    .sort((a, b) => b.score - a.score)[0].move;
  hintSquare = best.from;
  render();
  showToast(`Prova da ${String.fromCharCode(65 + best.from.c)}${8 - best.from.r}.`);
  setTimeout(() => { hintSquare = null; render(); }, 2100);
}

function render() {
  boardEl.innerHTML = '';
  const flipped = state.mode === 'ai' && state.humanColor === CREAM;
  boardEl.classList.toggle('flipped', flipped);
  document.querySelectorAll('.coordinates.top, .coordinates.bottom').forEach(row => {
    row.querySelectorAll('span').forEach((span, index) => {
      span.textContent = String.fromCharCode(65 + (flipped ? 7 - index : index));
    });
  });
  document.querySelectorAll('.coordinates.side').forEach(side => {
    side.querySelectorAll('span').forEach((span, index) => { span.textContent = flipped ? index + 1 : 8 - index; });
  });
  const targets = new Map();
  for (const move of candidates) targets.set(key(move.steps[0].to), Boolean(move.steps[0].captured));
  const legal = !turnSnapshot ? getLegalMoves(state.board, state.turn) : [];
  const movable = new Set(legal.map(move => key(move.from)));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const square = document.createElement('button');
      square.type = 'button';
      square.className = `square ${(r + c) % 2 ? 'dark' : 'light'}`;
      square.dataset.row = r;
      square.dataset.col = c;
      square.setAttribute('role', 'gridcell');
      const pos = { r, c };
      const piece = state.board[r][c];
      const coordinate = `${String.fromCharCode(65 + c)}${8 - r}`;
      square.setAttribute('aria-label', piece ? `${coordinate}, pedina ${piece.color === RED ? 'rossa' : 'avorio'}${piece.king ? ', dama' : ''}` : `${coordinate}, vuota`);
      if (samePos(selected, pos)) square.classList.add('selected');
      if (lastMove.some(p => samePos(p, pos))) square.classList.add('last-move');
      if (samePos(hintSquare, pos)) square.classList.add('hinted');
      if (movable.has(key(pos)) || targets.has(key(pos))) square.classList.add('playable');
      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.className = `piece ${piece.color}${piece.king ? ' king' : ''}`;
        square.appendChild(pieceEl);
      }
      if (targets.has(key(pos))) {
        const target = document.createElement('span');
        target.className = `target${targets.get(key(pos)) ? ' capture' : ''}`;
        target.setAttribute('aria-hidden', 'true');
        square.appendChild(target);
      }
      square.addEventListener('click', () => selectSquare(r, c));
      boardEl.appendChild(square);
    }
  }

  const reds = state.board.flat().filter(piece => piece?.color === RED).length;
  const creams = state.board.flat().filter(piece => piece?.color === CREAM).length;
  redCount.textContent = reds;
  creamCount.textContent = creams;
  moveCounter.textContent = `MOSSA ${state.moveNumber}`;
  redPlayer.classList.toggle('active', state.turn === RED);
  creamPlayer.classList.toggle('active', state.turn === CREAM);
  redPlayer.classList.toggle('chosen', state.mode === 'ai' && state.humanColor === RED);
  creamPlayer.classList.toggle('chosen', state.mode === 'ai' && state.humanColor === CREAM);
  redPlayer.setAttribute('aria-pressed', String(state.mode === 'ai' && state.humanColor === RED));
  creamPlayer.setAttribute('aria-pressed', String(state.mode === 'ai' && state.humanColor === CREAM));
  redPlayer.disabled = state.mode !== 'ai';
  creamPlayer.disabled = state.mode !== 'ai';
  scoreCard.classList.toggle('selectable', state.mode === 'ai');
  redLabel.textContent = state.mode === 'ai' ? (state.humanColor === RED ? 'TU · SELEZIONATO' : 'COMPUTER · TOCCA PER SCEGLIERE') : 'GIOCATORE 1';
  creamLabel.textContent = state.mode === 'ai' ? (state.humanColor === CREAM ? 'TU · SELEZIONATO' : 'COMPUTER · TOCCA PER SCEGLIERE') : 'GIOCATORE 2';
  turnBanner.classList.toggle('cream', state.turn === CREAM);
  turnText.textContent = aiThinking ? 'IL COMPUTER PENSA' : state.mode === 'ai' ? (state.turn === state.humanColor ? 'TOCCA A TE' : 'TURNO DEL COMPUTER') : state.turn === RED ? 'TURNO DEL ROSSO' : 'TURNO DELL’AVORIO';
  if (!selected) turnHint.textContent = aiThinking ? 'STA VALUTANDO LE DIAGONALI' : `SELEZIONA UNA PEDINA ${state.turn === RED ? 'ROSSA' : 'AVORIO'}`;
  else turnHint.textContent = candidates[0]?.steps[0].captured ? 'SCEGLI DOVE CATTURARE' : 'SCEGLI LA CASELLA';
  const onlyOpeningAI = state.mode === 'ai' && history.length === 1 && history[0].turn === aiColor();
  undoButton.disabled = !history.length || aiThinking || moveAnimating || onlyOpeningAI;
  hintButton.disabled = aiThinking || moveAnimating || Boolean(state.winner);
}

function setMode(mode) {
  if (aiThinking || moveAnimating) return;
  state.mode = mode;
  document.querySelectorAll('.segment').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  difficultyField.hidden = mode === 'local';
  resetGame();
}

function setPlayerColor(color) {
  if (state.mode !== 'ai' || aiThinking || moveAnimating || state.humanColor === color) return;
  state.humanColor = color;
  resetGame();
  showToast(`Giochi con ${color === RED ? 'il Rosso' : 'l’Avorio'}.`);
}

function resetGame() {
  const mode = state?.mode || 'ai';
  const soundEnabled = state?.sound ?? true;
  const humanColor = state?.humanColor || RED;
  state = newState();
  state.mode = mode;
  state.sound = soundEnabled;
  state.humanColor = humanColor;
  history = [];
  selected = null;
  candidates = [];
  turnSnapshot = null;
  lastMove = [];
  aiThinking = false;
  moveAnimating = false;
  gameOver.hidden = true;
  saveGame();
  render();
  if (isAITurn()) scheduleAI();
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function sound(type) {
  if (!state.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencies = { select: 280, move: 180, capture: 120, king: 520, win: 660, lose: 100 };
    osc.frequency.value = frequencies[type] || 200;
    osc.type = type === 'capture' ? 'square' : 'sine';
    gain.gain.setValueAtTime(.055, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + (type === 'win' ? .45 : .13));
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (type === 'win' ? .45 : .13));
  } catch { /* Audio is an enhancement, never a blocker. */ }
}

function saveGame() {
  try { localStorage.setItem('dama-game', JSON.stringify(state)); } catch { /* private mode */ }
}

function loadGame() {
  try {
    const saved = JSON.parse(localStorage.getItem('dama-game'));
    if (saved?.board?.length === SIZE && saved.mode) return saved;
  } catch { /* start fresh */ }
  return null;
}

document.querySelectorAll('.segment').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
introScreen.addEventListener('click', dismissIntro);
setTimeout(dismissIntro, 2400);
redPlayer.addEventListener('click', () => setPlayerColor(RED));
creamPlayer.addEventListener('click', () => setPlayerColor(CREAM));
difficultySelect.addEventListener('change', () => { state.difficulty = difficultySelect.value; saveGame(); });
newGameButton.addEventListener('click', resetGame);
playAgainButton.addEventListener('click', resetGame);
undoButton.addEventListener('click', undo);
hintButton.addEventListener('click', suggestMove);
soundButton.addEventListener('click', () => {
  state.sound = !state.sound;
  soundButton.classList.toggle('muted', !state.sound);
  soundButton.setAttribute('aria-label', state.sound ? 'Disattiva suoni' : 'Attiva suoni');
  saveGame();
  if (state.sound) sound('select');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !gameOver.hidden) gameOver.hidden = true;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
});

state = loadGame() || { board: initialBoard(), turn: RED, mode: 'ai', difficulty: 'medium', humanColor: RED, moveNumber: 1, sound: true, winner: null };
state.humanColor ||= RED;
difficultySelect.value = state.difficulty;
document.querySelectorAll('.segment').forEach(button => button.classList.toggle('active', button.dataset.mode === state.mode));
difficultyField.hidden = state.mode === 'local';
redLabel.textContent = state.mode === 'ai' ? (state.humanColor === RED ? 'TU' : 'COMPUTER') : 'GIOCATORE 1';
creamLabel.textContent = state.mode === 'ai' ? (state.humanColor === CREAM ? 'TU' : 'COMPUTER') : 'GIOCATORE 2';
soundButton.classList.toggle('muted', !state.sound);
render();
if (state.winner) showGameOver();
else if (isAITurn()) scheduleAI();
