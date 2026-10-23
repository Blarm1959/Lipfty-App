(function () {
  "use strict";

  const R = window.LipftyRules;
  const CORNERS = [0, 7, 56, 63];
  const ANCHORS = [...R.ANCHOR_SQUARES];
  const EDGE_DEFS = [
    { name: "top", cells: [1,2,3,4,5,6], corners: [0,1] },
    { name: "right", cells: [15,23,31,39,47,55], corners: [1,3] },
    { name: "bottom", cells: [57,58,59,60,61,62], corners: [2,3] },
    { name: "left", cells: [8,16,24,32,40,48], corners: [0,2] }
  ];
  const COLOURS = {
    black: ["Black", "#1d1d1d"], white: ["White", "#f8f8f4"],
    red: ["Red", "#d6423a"], blue: ["Blue", "#2d65ad"], green: ["Green", "#318653"],
    yellow: ["Yellow", "#e2ad34"], purple: ["Purple", "#7955a6"], orange: ["Orange", "#d97832"]
  };

  const el = id => document.getElementById(id);
  const boardEl = el("board");
  const statusEl = el("status");
  const currentEl = el("current-player");
  const reserveInfoEl = el("reserve-info");
  const blackBtn = el("choose-black");
  const whiteBtn = el("choose-white");
  const undoBtn = el("undo");
  const swapBox = el("swap-box");
  const jumpChoiceBox = el("jump-choice-box");

  let nextPieceId = 1;
  let state;
  let history = [];
  let timer = null;
  let clockInterval = null;
  let clockRemainingMs = [0, 0];
  let clockActivePlayer = null;
  let clockLastTick = null;
  let resultRecorded = false;
  let recordedResult = null;
  let match = null;

  function defaultSettings() {
    return {
      mode: "computer", level: "standard", version: "standard", starter: "random",
      player1: "Player", player2: "Player 2", colour1: "red", colour2: "blue",
      clockMinutes: 0, clockIncrement: 0, sound: true, animations: true, language: "en-GB",
      undo: true, matchLength: 5, colourDefaultsVersion: 1403
    };
  }
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty14-settings") || "{}");
      if (saved.colourDefaultsVersion !== 1403) {
        if ((saved.colour1 === undefined || saved.colour1 === "black") &&
            (saved.colour2 === undefined || saved.colour2 === "white")) {
          saved.colour1 = "red"; saved.colour2 = "blue";
        }
        saved.colourDefaultsVersion = 1403;
      }
      if (![1,3,5].includes(saved.matchLength)) saved.matchLength = 5;
      // The v18 Move/Jump obligation is incompatible with placement-only Learning.
      if (saved.version === "learning") saved.version = "standard";
      return { ...defaultSettings(), ...saved };
    } catch (_) { return defaultSettings(); }
  }
  function saveSettings() {
    try { localStorage.setItem("lipfty14-settings", JSON.stringify(settings)); } catch (_) {}
  }
  let settings = loadSettings();

  function colourCss(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][1]; }
  function colourName(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][0]; }

  function applyColours() {
    document.documentElement.style.setProperty("--piece-black", colourCss("black"));
    document.documentElement.style.setProperty("--piece-white", colourCss("white"));
    document.documentElement.classList.toggle("animations-off", settings.animations === false);
  }
  function isComputer(p) { return settings.mode === "computer" && p === 1; }
  function playerName(p) {
    if (isComputer(p)) return "Computer";
    if (settings.mode === "computer") return settings.player1 || "Player";
    return p === 0 ? (settings.player1 || "Player 1") : (settings.player2 || "Player 2");
  }
  function other(p) { return p === 0 ? 1 : 0; }

  function shuffled(a) {
    a = [...a];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshReserve() {
    const active = Array(64).fill(null), locked = Array(64).fill(null);
    const normal = EDGE_DEFS.flatMap(e => e.cells);
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")]).forEach((c,i) => active[normal[i]] = c);
    shuffled(["black","black","white","white"]).forEach((c,slot)=>locked[CORNERS[slot]]=c);
    return { active, locked };
  }

  function chooseStarter() {
    if (settings.starter === "player") return 0;
    if (settings.starter === "computer") return 1;
    if (settings.starter === "alternate") {
      const previous = localStorage.getItem("lipfty14-last-starter") || "computer";
      const next = previous === "player" ? "computer" : "player";
      localStorage.setItem("lipfty14-last-starter", next);
      return next === "player" ? 0 : 1;
    }
    return Math.random() < 0.5 ? 0 : 1;
  }

  function freshState(starter = chooseStarter()) {
    const reserve = freshReserve();
    const board=Array(36).fill(null);
    // v13.0.4 opening anchors: equal colours on opposite diagonals.
    [[0,"black"],[5,"white"],[30,"white"],[35,"black"]].forEach(([i,colour])=>{
      board[i]={id:nextPieceId++,colour,pinned:true,special:true,anchor:true};
    });
    return {
      phase: "main",
      board,
      finalFourPhase:false,
      reserve,
      openingReserve: Array(64).fill(null),
      selectedOpeningIndex: null,
      releasedCorners: [false,false,false,false],
      clearedEdges: [false,false,false,false],
      openingRemaining: { black: 0, white: 0 },
      openingPlaced: 0,
      // Opening chooser selects an ordinary colour for the first placer.
      currentPlayer: other(starter),
      colourChooser: starter,
      openingChooser: starter,
      firstPlacer: other(starter),
      heldCorners: [null,null],
      qualificationCornerColours: [null,null],
      qualified: [false,false],
      cornerPickFor: null,
      cornerReturnFor: null,
      pendingReturnPlayer: null,
      deferredTurn: null,
      choosingColour: true,
      assignedColour: null,
      selectedReserveIndex: null,
      selectedBoardIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      protectedPieceId: null,
      consequence: null,
      redeployPiece: null,
      pendingSwap: null,
      swapDone: false,
      winner: null,
      winningCells: [],
      winType: null,
      lastReleaseMessage: "",
      positionDecisionMessage: ""
    };
  }

  function cloneState(s) {
    return {
      ...s,
      board: s.board.map(p => p ? {...p} : null),
      reserve: { active: [...s.reserve.active], locked: [...s.reserve.locked] },
      openingReserve: [...s.openingReserve],
      releasedCorners: [...s.releasedCorners], clearedEdges: [...s.clearedEdges],
      openingRemaining: {...s.openingRemaining},
      heldCorners: s.heldCorners.map(c => c ? {...c} : null),
      qualificationCornerColours: [...s.qualificationCornerColours],
      qualified: [...s.qualified],
      deferredTurn: s.deferredTurn ? {...s.deferredTurn} : null,
      legalMoves: new Set(s.legalMoves), legalJumps: new Map(s.legalJumps),
      consequence: s.consequence ? {...s.consequence, jumpedPiece: s.consequence.jumpedPiece ? {...s.consequence.jumpedPiece} : null} : null,
      redeployPiece: s.redeployPiece ? {...s.redeployPiece} : null,
      pendingSwap: s.pendingSwap ? {...s.pendingSwap} : null,
      winningCells: [...s.winningCells]
    };
  }
  function checkpoint() {
    if (!settings.undo || state.winner !== null) return;
    settleClock();
    history.push({ state: cloneState(state), match: cloneMatch(), clock: { remainingMs: [...clockRemainingMs], activePlayer: clockActivePlayer } });
    if (history.length > 60) history.shift();
  }
  function undoActor(s) {
    return s.pendingSwap ? s.pendingSwap.decider : s.cornerPickFor!==null ? s.cornerPickFor : s.cornerReturnFor!==null ? s.cornerReturnFor : s.choosingColour ? s.colourChooser : s.currentPlayer;
  }
  function canUndo() {
    return settings.undo && history.some(snap => !isComputer(undoActor(snap.state)));
  }
  function undo() {
    if (!canUndo()) return;
    clearTimeout(timer);
    rollbackResult();
    let snap;
    // Return to a human decision, so the computer cannot immediately replay it.
    do { snap = history.pop(); } while (isComputer(undoActor(snap.state)));

    state = snap.state;
    match = snap.match;
    restoreClock(snap.clock);
    render(); processFlow();
  }

  function ordinaryReserveIndices(exclude = null) {
    return state.reserve.active.map((colour,i) => colour && i !== exclude && !CORNERS.includes(i) ? i : null).filter(i => i !== null);
  }
  function activeReserveIndices(colour = null, exclude = null) {
    if (state.finalFourPhase) return CORNERS.filter(i=>state.reserve.locked[i] && (!colour || state.reserve.locked[i]===colour));
    return ordinaryReserveIndices(exclude).filter(i => !colour || state.reserve.active[i] === colour);
  }

  function reserveCount(colour) { return activeReserveIndices(colour).length; }
  function reserveTotal() { return activeReserveIndices().length; }
  function reserveColourCount() { return ["black","white"].filter(c => reserveCount(c) > 0).length; }
  function placementOnlyNow() { return state.finalFourPhase || (reserveTotal()>0 && reserveColourCount()===1 && !state.consequence && !state.redeployPiece); }

  function blockedAnchors() { return []; }

  function ruleOptions() {
    return {
      allowDiagonal: true,
      allowSquare: settings.version === "extreme",
      allowSpacedSquare: settings.version === "extreme",
      inactiveWinCells: blockedAnchors()
    };
  }

  function finishWin() {
    const w = R.checkWin(state.board, ruleOptions());
    // A four-piece pattern wins only after its maker has Move/Jump-qualified.
    if (!w || !state.qualified[state.currentPlayer]) return false;
    // A winning Move/Jump cancels the compulsory continuation. Return its
    // already-earned corner piece automatically before ending the game.
    if (state.pendingReturnPlayer === state.currentPlayer) {
      const vacant = CORNERS.find(i => !state.reserve.locked[i]);
      if (vacant !== undefined) putHeldCorner(state.currentPlayer, vacant);
      state.pendingReturnPlayer = null;
    }
    state.winner = state.currentPlayer;
    state.winningCells = [...w.line];
    state.winType = w.type;
    state.choosingColour = false;
    state.selectedBoardIndex = null;
    stopClock(); maybeRecordResult(); playTone("win");
    render();
    maybeOfferUpdate();
    return true;
  }

  function putHeldCorner(player, index) {
    const held = state.heldCorners[player];
    if (!held || !CORNERS.includes(index) || state.reserve.locked[index]) return false;
    state.reserve.locked[index] = held.colour;
    state.qualificationCornerColours[player] = held.colour;
    state.heldCorners[player] = null;
    return true;
  }

  function pickOpeningCorner(index) {
    const player = state.cornerPickFor;
    if (player === null || state.winner !== null || !state.reserve.locked[index] ||
        !CORNERS.includes(index) || isComputer(player)) return;
    checkpoint();
    state.heldCorners[player] = { colour:state.reserve.locked[index], source:index };
    state.qualificationCornerColours[player] = state.heldCorners[player].colour;
    state.reserve.locked[index] = null;
    state.cornerPickFor = null;
    state.currentPlayer = state.firstPlacer;
    render(); processFlow();
  }

  function returnCorner(index) {
    const player = state.cornerReturnFor;
    if (player === null || isComputer(player) || !CORNERS.includes(index) ||
        state.reserve.locked[index] || state.winner !== null) return;
    checkpoint();
    finishCornerReturn(index);
  }

  function finishCornerReturn(index) {
    const player = state.cornerReturnFor;
    if (player === null || !putHeldCorner(player,index)) return;
    state.cornerReturnFor = null;
    const next = state.deferredTurn;
    state.deferredTurn = null;
    if (!next) throw new Error("Missing deferred turn after corner return");
    nextNormalTurn(next.current,next.chooser,next.protectedId);
  }

  function finishQualificationForfeit() {
    const missing = state.qualified.map((ok,p)=>ok?null:p).filter(p=>p!==null);
    if (!missing.length) return false;
    // If neither player qualified, the first ordinary placer loses.
    const loser = missing.length===2 ? state.firstPlacer : missing[0];
    state.winner = other(loser);
    state.winType = "qualification";
    state.choosingColour = false;
    state.pendingReturnPlayer = null;
    state.cornerReturnFor = null;
    state.cornerPickFor = null;
    state.consequence = null;
    state.redeployPiece = null;
    clearSelection();
    stopClock(); maybeRecordResult(); playTone("win"); render(); maybeOfferUpdate();
    return true;
  }

  function releaseCorner(slot) {
    if (state.releasedCorners[slot]) return false;
    state.releasedCorners[slot] = true;
    const outer = CORNERS[slot];
    const colour = state.reserve.locked[outer];
    if (colour) {
      state.reserve.active[outer] = colour;
      state.reserve.locked[outer] = null;
    }
    return true;
  }
  function updateEdgeReleases() {
    state.releasedCorners = CORNERS.map(i => !!state.reserve.active[i] && ordinaryReserveIndices().length === 0);
  }

  function consumeReserve(index) {
    const colour = CORNERS.includes(index) && state.finalFourPhase ? state.reserve.locked[index] : state.reserve.active[index];
    if (!colour || (CORNERS.includes(index) && !state.finalFourPhase)) return null;
    const piece = { id: nextPieceId++, colour, pinned: CORNERS.includes(index), special: CORNERS.includes(index), anchor: false };
    if (CORNERS.includes(index)) state.reserve.locked[index]=null;
    else state.reserve.active[index]=null;
    updateEdgeReleases();
    return piece;
  }

  function availableChoiceColours() {
    if (state.finalFourPhase) return ["black","white"].filter(c=>activeReserveIndices(c).length);
    if (state.phase === "opening") return ["black","white"].filter(c => state.openingRemaining[c] > 0);
    if (state.consequence?.type === "jump-choice") return [state.consequence.heldColour, state.consequence.jumpedPiece.colour];
    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    return ["black","white"].filter(c => activeReserveIndices(c, exclude).length > 0);
  }

  function chooseColour(colour, exactIndex = null) {
    if (!state.choosingColour || state.winner !== null) return;
    if (!availableChoiceColours().includes(colour)) return;
    checkpoint();

    if (state.phase === "opening") {
      const sources = CORNERS.filter(index => state.openingReserve[index] === colour);
      if (!sources.length || (exactIndex !== null && !sources.includes(exactIndex))) return;
      state.selectedOpeningIndex = exactIndex !== null ? exactIndex : sources[Math.floor(Math.random() * sources.length)];
      state.assignedColour = colour;
      state.choosingColour = false;
      render(); processFlow(); return;
    }
    if (state.consequence?.type === "jump-choice") {
      applyJumpChoice(colour); return;
    }

    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    let candidates = activeReserveIndices(colour, exclude);
    if (exactIndex !== null) candidates = candidates.includes(exactIndex) ? [exactIndex] : [];
    if (!candidates.length) return;
    state.selectedReserveIndex = candidates[Math.floor(Math.random() * candidates.length)];
    state.assignedColour = colour;
    state.choosingColour = false;
    if (!state.heldCorners[state.firstPlacer] && state.cornerPickFor === null && !state.swapDone) {
      const first = CORNERS.find(i=>state.reserve.locked[i]===colour);
      if (first === undefined) throw new Error("No opening corner matches selected colour");
      state.heldCorners[state.firstPlacer] = { colour, source:first };
      state.qualificationCornerColours[state.firstPlacer] = colour;
      state.reserve.locked[first] = null;
      state.cornerPickFor = state.openingChooser;
    }
    render(); processFlow();
  }

  function clearSelection() {
    state.selectedBoardIndex = null;
    state.legalMoves = new Set();
    state.legalJumps = new Map();
  }

  function nextNormalTurn(current, chooser, protectedId = null) {
    // A newly earned corner is returned after *both* compulsory placements.
    if (state.pendingReturnPlayer !== null) {
      state.deferredTurn = {current,chooser,protectedId};
      state.cornerReturnFor = state.pendingReturnPlayer;
      state.pendingReturnPlayer = null;
      state.currentPlayer = state.cornerReturnFor;
      state.choosingColour = false;
      state.assignedColour = null;
      state.selectedReserveIndex = null;
      state.consequence = null;
      state.redeployPiece = null;
      clearSelection();
      render(); processFlow();
      return;
    }
    // Under v18 the first colour exhausted is the qualification deadline.
    if (ordinaryReserveIndices().length < 24 &&
        ["black","white"].some(colour=>ordinaryReserveIndices().every(i=>state.reserve.active[i]!==colour)) &&
        finishQualificationForfeit()) return;
    state.phase = "main";
    state.currentPlayer = current;
    state.colourChooser = chooser;
    state.protectedPieceId = protectedId;
    state.choosingColour = true;
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    state.consequence = null;
    state.redeployPiece = null;
    clearSelection();
    if (reserveTotal() === 0) {
      if (!state.finalFourPhase) {
        state.finalFourPhase=true;
        state.colourChooser=current; // Final Four are selected by the player placing them.
      }
      if (!CORNERS.some(i=>state.reserve.locked[i])) finishDraw();
    }
    render(); processFlow();
  }

  function finishDraw() {
    if (state.winner !== null) return;
    state.winner = "draw";
    state.choosingColour = false;
    stopClock(); maybeRecordResult();
    render();
    maybeOfferUpdate();
  }

  function afterOpeningPlacement(placer) {
    // Opening Four is setup only: complete all four corner placements before
    // the Lipfty take/accept decision becomes available.
    const next = other(placer);
    state.currentPlayer = next;
    state.colourChooser = placer;
    state.choosingColour = true;
    state.assignedColour = null;
    if (state.openingPlaced >= 4) {
      state.phase = "main";
      render(); processFlow();
      return;
    }

    // Once only one colour remains, the remaining corners have the same
    // final contents whichever source/corner is used first. Complete setup.
    const remainingAnchors = ANCHORS.filter(i => !state.board[i]);
    const remainingColours = ["black","white"].filter(c => state.openingRemaining[c] > 0);
    if (remainingAnchors.length > 0 && remainingColours.length === 1) {
      state.assignedColour = remainingColours[0];
      state.selectedOpeningIndex = CORNERS.find(i => state.openingReserve[i] === remainingColours[0]);
      state.choosingColour = false;
      placeOpening(remainingAnchors[0], true);
      return;
    }

    render(); processFlow();
  }

  function placeOpening(index, automatic = false) {
    if (state.phase !== "opening" || state.choosingColour || !ANCHORS.includes(index) || state.board[index]) return;
    if (!automatic) checkpoint();
    const colour = state.assignedColour;
    if (!colour || state.openingRemaining[colour] <= 0) return;
    if (state.selectedOpeningIndex === null || state.openingReserve[state.selectedOpeningIndex] !== colour) return;
    state.openingReserve[state.selectedOpeningIndex] = null;
    state.selectedOpeningIndex = null;
    state.board[index] = { id: nextPieceId++, colour, pinned: true, special: true, anchor: true };
    playTone("place");
    state.openingRemaining[colour] -= 1;
    state.openingPlaced += 1;
    state.assignedColour = null;
    afterOpeningPlacement(state.currentPlayer);
  }

  function resolveSwap(swap, exactIndex = null) {
    if (!state.pendingSwap) return;
    if (exactIndex !== null && (swap || isComputer(state.pendingSwap.decider) || !activeReserveIndices().includes(exactIndex))) return;
    checkpoint();
    const { placer, decider } = state.pendingSwap;
    state.pendingSwap = null;
    state.positionDecisionMessage = `${playerName(decider)} chose ${swap ? "Take position" : "Accept"}. The first placement stays on the board.`;
    state.currentPlayer = swap ? placer : decider;
    state.colourChooser = swap ? decider : placer;
    state.choosingColour = exactIndex === null;
    state.selectedReserveIndex = exactIndex;
    state.assignedColour = exactIndex === null ? null : state.reserve.active[exactIndex];
    render(); processFlow();
  }

  function placePiece(index) {
    if (state.winner !== null || state.choosingColour || state.board[index] ||
        state.cornerPickFor !== null || state.cornerReturnFor !== null) return;
    checkpoint();
    state.positionDecisionMessage = "";

    if (state.redeployPiece) {
      state.board[index] = state.redeployPiece;
      playTone("place");
      state.redeployPiece = null;
      if (finishWin()) return;
      const c = state.consequence;
      if (c?.type === "jump-redeploy-first") {
        state.currentPlayer = c.jumper;
        state.assignedColour = c.heldColour;
        state.selectedReserveIndex = c.heldIndex;
        state.consequence = { ...c, type: "jump-held-second" };
        render(); processFlow(); return;
      }
      if (c?.type === "jump-jumped-second") {
        nextNormalTurn(c.responder, c.jumper, c.protectedPieceId); return;
      }
      return;
    }

    if (state.selectedReserveIndex === null || !state.assignedColour) return;
    const sourceIndex = state.selectedReserveIndex;
    const piece = consumeReserve(sourceIndex);
    if (!piece) return;
    state.board[index] = piece;
    playTone("place");
    state.selectedReserveIndex = null;
    state.assignedColour = null;
    clearSelection();
    if (finishWin()) return;

    // Lipfty 14 pie rule: the Opening Four are setup. Only the first ordinary
    // placement on the remaining 32 squares can be accepted or taken by the
    // other player. Accept means the other player continues normally; Take
    // means they take this position and make the original placer continue.
    if (!state.swapDone && state.phase === "main" && !state.consequence) {
      const placer = state.currentPlayer;
      state.swapDone = true;
      state.pendingSwap = { placer, decider: other(placer), firstNormalIndex: index, colour: piece.colour };
      state.choosingColour = false;
      render(); processFlow(); return;
    }

    const c = state.consequence;
    if (c?.type === "move" && c.step === 1) {
      state.currentPlayer = c.mover;
      state.selectedReserveIndex = c.heldIndex;
      state.assignedColour = c.heldColour;
      state.choosingColour = false;
      state.consequence = { ...c, step: 2 };
      render(); processFlow(); return;
    }
    if (c?.type === "move" && c.step === 2) {
      nextNormalTurn(c.responder, c.mover, c.protectedPieceId); return;
    }
    if (c?.type === "jump-held-first") {
      state.currentPlayer = c.jumper;
      state.redeployPiece = c.jumpedPiece;
      state.consequence = { ...c, type: "jump-jumped-second" };
      render(); processFlow(); return;
    }
    if (c?.type === "jump-held-second") {
      nextNormalTurn(c.responder, c.jumper, c.protectedPieceId); return;
    }

    nextNormalTurn(other(state.currentPlayer), state.currentPlayer, null);
  }

  function canMoveOrJump() {
    return settings.version !== "learning" && !state.consequence && !state.redeployPiece &&
      state.cornerPickFor === null && state.cornerReturnFor === null &&
      !CORNERS.includes(state.selectedReserveIndex) && !placementOnlyNow();
  }

  function selectBoardPiece(index) {
    if (!canMoveOrJump() || state.choosingColour || state.winner !== null) return;
    const p = state.board[index];
    if (!p || p.colour !== state.assignedColour || p.pinned || p.id === state.protectedPieceId) return;
    if (state.selectedBoardIndex === index) { clearSelection(); render(); return; }
    state.selectedBoardIndex = index;
    state.legalMoves = new Set(activeReserveIndices(null,state.selectedReserveIndex).length ? R.adjacentDestinations(state.board,index) : []);
    state.legalJumps = new Map(R.jumpDestinations(state.board,index)
      .filter(j => state.board[j.over] && !state.board[j.over].pinned && state.board[j.over].colour !== p.colour)
      .map(j => [j.to,j]));
    render();
  }

  function moveOrJump(to) {
    if (!canMoveOrJump()) return;
    const from = state.selectedBoardIndex;
    if (from === null) return;
    const jump = state.legalJumps.get(to) || null;
    const isJump = !!jump;
    if (!state.legalMoves.has(to) && !isJump) return;
    checkpoint();
    state.positionDecisionMessage = "";
    const piece = state.board[from];
    state.board[from] = null;
    state.board[to] = piece;
    playTone(isJump ? "jump" : "move");
    clearSelection();
    if (!state.qualified[state.currentPlayer]) {
      state.qualified[state.currentPlayer] = true;
      state.pendingReturnPlayer = state.currentPlayer;
    }
    if (finishWin()) return;

    const heldIndex = state.selectedReserveIndex, heldColour = state.assignedColour;
    const mover = state.currentPlayer, responder = other(mover);
    if (!isJump) {
      state.consequence = { type:"move", step:1, mover, responder, heldIndex, heldColour, protectedPieceId: piece.id };
      state.currentPlayer = responder;
      state.colourChooser = responder;
      state.protectedPieceId = piece.id;
      state.selectedReserveIndex = null; state.assignedColour = null; state.choosingColour = true;
      render(); processFlow(); return;
    }

    const jumped = jump ? state.board[jump.over] : null;
    if (!jumped) return;
    state.board[jump.over] = null;
    state.consequence = { type:"jump-choice", jumper:mover, responder, heldIndex, heldColour, jumpedPiece:jumped, protectedPieceId:piece.id };
    state.currentPlayer = responder;
    state.colourChooser = responder;
    state.protectedPieceId = piece.id;
    state.selectedReserveIndex = null; state.assignedColour = null; state.choosingColour = true;
    render(); processFlow();
  }

  function applyJumpChoice(colour) {
    const c = state.consequence;
    if (!c || c.type !== "jump-choice") return;
    state.choosingColour = false;
    state.currentPlayer = c.responder;
    if (colour === c.jumpedPiece.colour) {
      state.redeployPiece = c.jumpedPiece;
      state.consequence = { ...c, type:"jump-redeploy-first" };
    } else {
      state.selectedReserveIndex = c.heldIndex;
      state.assignedColour = c.heldColour;
      state.consequence = { ...c, type:"jump-held-first" };
    }
    render(); processFlow();
  }

  function handleInner(index) {
    if (state.pendingSwap || state.winner !== null || state.cornerPickFor !== null ||
        state.cornerReturnFor !== null || isComputer(state.currentPlayer)) return;
    if (state.phase === "opening") { placeOpening(index); return; }
    if (state.choosingColour) return;
    if (state.selectedBoardIndex !== null && (state.legalMoves.has(index) || state.legalJumps.has(index))) { moveOrJump(index); return; }
    if (state.board[index]) { selectBoardPiece(index); return; }
    if (state.selectedBoardIndex !== null) return;
    placePiece(index);
  }

  function chooseExactReserve(displayIndex) {
    if (!state.choosingColour || state.winner !== null || isComputer(state.colourChooser)) return;
    const colour = state.finalFourPhase ? state.reserve.locked[displayIndex] : state.reserve.active[displayIndex];
    if (!colour) return;
    chooseColour(colour, displayIndex);
  }

  function winOptions(inactiveWinCells = blockedAnchors()) {
    return { ...ruleOptions(), inactiveWinCells };
  }

  function blockedAnchorsAfterReserveRemoval() { return []; }

  function patternsFor(options) {
    const blocked = new Set(options.inactiveWinCells || []);
    const patterns = [...R.ORTHOGONAL_LINES, ...R.DIAGONAL_LINES];
    if (options.allowSquare) patterns.push(...(options.allowSpacedSquare ? R.AXIS_SQUARES : R.TIGHT_SQUARES));
    return patterns.filter(pattern => !pattern.some(i => blocked.has(i)));
  }

  function patternProgress(board, colour, inactiveWinCells = blockedAnchors()) {
    const weights = [0, 1, 5, 24, 5000];
    let score = 0;
    for (const pattern of patternsFor(winOptions(inactiveWinCells))) {
      let own = 0, blocked = false;
      for (const index of pattern) {
        const piece = board[index];
        if (!piece) continue;
        if (piece.colour !== colour) { blocked = true; break; }
        own += 1;
      }
      if (!blocked) score += weights[own];
    }
    return score;
  }

  function countImmediatePlacementWins(board, colour, inactiveWinCells = blockedAnchors()) {
    const options = winOptions(inactiveWinCells);
    let wins = 0;
    for (let to = 0; to < 36; to += 1) {
      if (board[to]) continue;
      const copy = [...board];
      copy[to] = { colour };
      if (R.checkWin(copy, options)) wins += 1;
    }
    return wins;
  }

  function centreScore(index) {
    const r = Math.floor(index / 6), c = index % 6;
    return 6 - (Math.abs(r - 2.5) + Math.abs(c - 2.5));
  }

  function boardAfterAction(action, removeJumped = false) {
    const board = state.board.map(piece => piece ? { ...piece } : null);
    if (action.type === "place") {
      board[action.to] = { colour: state.assignedColour, special: CORNERS.includes(state.selectedReserveIndex), pinned: CORNERS.includes(state.selectedReserveIndex) };
    } else {
      const piece = board[action.from];
      board[action.from] = null;
      board[action.to] = piece;
      if (removeJumped && action.type === "jump") board[action.over] = null;
    }
    return board;
  }

  function actionInactiveWinCells(action) {
    return action.type === "place"
      ? blockedAnchorsAfterReserveRemoval(state.selectedReserveIndex)
      : blockedAnchors();
  }

  function actionWouldWin(action) {
    // The live game checks a Move/Jump win immediately after the moving piece
    // lands, before a jumped piece is removed. Mirror that exact timing here.
    return (state.qualified[state.currentPlayer] || action.type !== "place") &&
      !!R.checkWin(boardAfterAction(action, false), winOptions(actionInactiveWinCells(action)));
  }

  function enumerateComputerActions() {
    const actions = [];
    if (state.selectedReserveIndex !== null) {
      for (let to = 0; to < 36; to += 1) if (!state.board[to]) actions.push({ type:"place", to });
    }
    if (!canMoveOrJump()) return actions;
    for (let from = 0; from < 36; from += 1) {
      const piece = state.board[from];
      if (!piece || piece.colour !== state.assignedColour || piece.pinned || piece.id === state.protectedPieceId) continue;
      if (activeReserveIndices(null,state.selectedReserveIndex).length) R.adjacentDestinations(state.board, from).forEach(to => actions.push({ type:"move", from, to }));
      R.jumpDestinations(state.board, from)
        .filter(j => state.board[j.over] && !state.board[j.over].pinned && state.board[j.over].colour !== piece.colour)
        .forEach(j => actions.push({ type:"jump", from, to:j.to, over:j.over }));
    }
    return actions;
  }

  function positionalActionScore(action, expert = false) {
    const board = boardAfterAction(action, true);
    const inactive = actionInactiveWinCells(action);
    let score = patternProgress(board, state.assignedColour, inactive) * 6 + centreScore(action.to);
    if (action.type === "jump") score += 2;
    else if (action.type === "move") score += 1;
    // Being able to win at all is worth far more than cosmetic pattern score.
    if (!state.qualified[state.currentPlayer] && action.type !== "place") score += 28000;

    // A pattern made by a non-qualified player is not a victory.
    if (!state.qualified[state.currentPlayer] && action.type === "place" &&
        R.checkWin(board, winOptions(inactive))) score -= 30000;
    if (expert) {
      const risks = ["black","white"].map(colour => countImmediatePlacementWins(board, colour, inactive));
      // After an ordinary placement the computer will choose the opponent's
      // next colour, so it can select the safer colour. After Move/Jump the
      // responder chooses for themselves, so assume they take the more dangerous one.
      const receiverRisk = action.type === "place" ? Math.min(...risks) : Math.max(...risks);
      score -= (state.qualified[other(state.currentPlayer)] ? receiverRisk : 0) * 900;
    }
    return score;
  }

  function chooseBestByScore(items, scoreOf, highest = true) {
    if (!items.length) return null;
    let bestScore = highest ? -Infinity : Infinity;
    let best = [];
    for (const item of items) {
      const score = scoreOf(item);
      const better = highest ? score > bestScore : score < bestScore;
      if (better) { bestScore = score; best = [item]; }
      else if (score === bestScore) best.push(item);
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  function computerChooseColour() {
    if (!isComputer(state.colourChooser) || !state.choosingColour) return;

    if (state.phase === "opening") {
      const colours = availableChoiceColours();
      if (!colours.length) { finishDraw(); return; }
      chooseColour(colours[Math.floor(Math.random() * colours.length)]);
      return;
    }

    if (state.consequence?.type === "jump-choice") {
      const c = state.consequence;
      const choices = [c.heldColour, c.jumpedPiece.colour];
      if (settings.level === "beginner") {
        applyJumpChoice(choices[Math.floor(Math.random() * choices.length)]);
        return;
      }
      const chosen = chooseBestByScore(choices, colour =>
        countImmediatePlacementWins(state.board, colour) * 1000 +
        (settings.level === "expert" ? patternProgress(state.board, colour) : 0), true);
      applyJumpChoice(chosen);
      return;
    }

    const colours = availableChoiceColours();
    if (!colours.length) { finishDraw(); return; }
    if (settings.level === "beginner") {
      chooseColour(colours[Math.floor(Math.random() * colours.length)]);
      return;
    }

    // During the first Move consequence the chooser is also the player who
    // places the selected reserve piece, so maximise their opportunity. On a
    // normal handover the computer is choosing for its opponent, so minimise it.
    const selfPlacement = state.consequence?.type === "move" && state.consequence.step === 1 && state.currentPlayer === state.colourChooser;
    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;

    if (settings.level === "standard") {
      const chosenColour = chooseBestByScore(colours, colour => {
        const wins = countImmediatePlacementWins(state.board, colour);
        return (state.qualified[state.currentPlayer] ? wins * 1000 : 0) + patternProgress(state.board, colour);
      }, selfPlacement);
      chooseColour(chosenColour);
      return;
    }

    // Expert also chooses the exact physical reserve piece. That matters in
    // Lipfty 15 because placing an outside special piece unblocks its
    // matching inner anchor; clearing an edge only makes corners available.
    const candidates = [];
    for (const colour of colours) {
      for (const index of activeReserveIndices(colour, exclude)) candidates.push({ colour, index });
    }
    const chosen = chooseBestByScore(candidates, option => {
      const inactive = blockedAnchorsAfterReserveRemoval(option.index);
      const wins = countImmediatePlacementWins(state.board, option.colour, inactive);
      const progress = patternProgress(state.board, option.colour, inactive);
      return (state.qualified[state.currentPlayer] ? wins * 1000 : 0) + progress;
    }, selfPlacement);
    if (chosen) chooseColour(chosen.colour, chosen.index);
  }

  function computerPlay() {
    if (!isComputer(state.currentPlayer) || state.choosingColour || state.winner !== null) return;
    if (state.phase === "opening") {
      const choices = ANCHORS.filter(i => !state.board[i]);
      placeOpening(choices[Math.floor(Math.random()*choices.length)]);
      return;
    }

    if (state.redeployPiece) {
      const empties = state.board.map((piece,index) => piece ? null : index).filter(index => index !== null);
      if (!empties.length) { finishDraw(); return; }
      if (settings.level === "beginner") {
        placePiece(empties[Math.floor(Math.random()*empties.length)]);
        return;
      }
      const colour = state.redeployPiece.colour;
      const winning = empties.filter(to => {
        const board = [...state.board]; board[to] = { colour };
        return state.qualified[state.currentPlayer] && !!R.checkWin(board, ruleOptions());
      });
      const pool = winning.length ? winning : empties;
      const chosen = winning.length ? pool[Math.floor(Math.random()*pool.length)] :
        chooseBestByScore(pool, to => {
          const board = [...state.board]; board[to] = { colour };
          return patternProgress(board, colour) * 6 + centreScore(to);
        }, true);
      placePiece(chosen);
      return;
    }

    const actions = enumerateComputerActions();
    if (!actions.length) { finishDraw(); return; }
    if (settings.level === "beginner") {
      const action = actions[Math.floor(Math.random()*actions.length)];
      if (action.type === "place") placePiece(action.to);
      else { selectBoardPiece(action.from); moveOrJump(action.to); }
      return;
    }

    const wins = actions.filter(actionWouldWin);
    const candidates = wins.length ? wins : actions;
    // Difficulty 2 also evaluates the next player's winning replies.
    // Shared colours make greedy line-building an unsafe default.
    const action = wins.length
      ? candidates[Math.floor(Math.random()*candidates.length)]
      : chooseBestByScore(candidates, candidate => positionalActionScore(candidate, true), true);
    if (action.type === "place") placePiece(action.to);
    else { selectBoardPiece(action.from); moveOrJump(action.to); }
  }

  function firstSquareStrength(index) {
    if (!Number.isInteger(index)) return 0;
    return patternsFor(ruleOptions()).filter(pattern => pattern.includes(index)).length;
  }

  function computerSwapDecision() {
    if (!state.pendingSwap) return false;
    if (settings.level === "beginner") return Math.random() < 0.5;
    const strength = firstSquareStrength(state.pendingSwap.firstNormalIndex);
    if (settings.level === "expert") return strength >= 7;
    return strength >= 8;
  }

  function autoChooseOnlyColour() {
    if (!state || state.winner !== null || state.pendingSwap || !state.choosingColour ||
        state.phase !== "main" || state.consequence?.type === "jump-choice") return false;
    const colours = availableChoiceColours();
    if (colours.length !== 1) return false;
    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    const sources = activeReserveIndices(colours[0], exclude);
    if (!sources.length) return false;
    state.selectedReserveIndex = sources[Math.floor(Math.random() * sources.length)];
    state.assignedColour = colours[0];
    state.choosingColour = false;
    clearSelection();
    return true;
  }

  function processFlow() {
    clearTimeout(timer);
    // Resolve forced colour handovers before assigning the decision clock.
    // No checkpoint: Undo should return to a meaningful player decision.
    const automatic = autoChooseOnlyColour();
    syncClock();
    if (automatic) render();
    if (state.winner !== null) return;
    const shortDelay = settings.animations ? 180 : 0;
    const playDelay = settings.animations ? 420 : 0;
    if (state.pendingSwap) {
      if (isComputer(state.pendingSwap.decider)) timer = setTimeout(()=>resolveSwap(computerSwapDecision()), shortDelay);
      return;
    }
    if (state.cornerPickFor !== null) {
      if (isComputer(state.cornerPickFor)) timer=setTimeout(()=>{
        const i=CORNERS.filter(i=>state.reserve.locked[i]);
        if (i.length) {
          const player=state.cornerPickFor, chosen=i[Math.floor(Math.random()*i.length)];
          checkpoint();state.heldCorners[player]={colour:state.reserve.locked[chosen],source:chosen};
          state.qualificationCornerColours[player]=state.heldCorners[player].colour;
          state.reserve.locked[chosen]=null;state.cornerPickFor=null;
          state.currentPlayer=state.firstPlacer;render();processFlow();
        }
      },shortDelay);
      return;
    }
    if (state.cornerReturnFor !== null) {
      if (isComputer(state.cornerReturnFor)) timer=setTimeout(()=>{
        const empty=CORNERS.find(i=>!state.reserve.locked[i]);
        if (empty!==undefined) {checkpoint();finishCornerReturn(empty);}
      },shortDelay);
      return;
    }
    if (state.choosingColour && isComputer(state.colourChooser)) { timer = setTimeout(computerChooseColour, shortDelay); return; }
    if (!state.choosingColour && isComputer(state.currentPlayer)) { timer = setTimeout(computerPlay, playDelay); }
  }

  function statusText() {
    const explanation=state.winner===null && !state.pendingSwap ? state.positionDecisionMessage : "";
    return (explanation ? explanation + " " : "") + turnStatusText();
  }
  function turnStatusText() {
    if (state.winner === "draw") return "Draw — no playable reserve piece remains without a win.";
    if (state.winner !== null) {
      if (state.winType === "qualification") return `${playerName(state.winner)} wins: opponent did not complete a Move or Jump before a reserve colour ran out.`;
      if (state.winType === "time") return `${playerName(state.winner)} wins on time.`;
      return `${playerName(state.winner)} wins${state.winType === "square" ? " with a square" : " with four in a row"}.`;
    }
    if (state.pendingSwap) return `${playerName(state.pendingSwap.decider)}: accept the first placement or take the position?`;
    if (state.cornerPickFor !== null) return `${playerName(state.cornerPickFor)}: choose any remaining outside corner piece to hold until your first Move or Jump.`;
    if (state.cornerReturnFor !== null) return `${playerName(state.cornerReturnFor)}: select an empty outside corner to return your earned special piece.`;
    if (state.phase === "opening") {
      if (state.choosingColour) return `${playerName(state.colourChooser)}: choose the colour ${playerName(state.currentPlayer)} must place as an Opening Four piece.`;
      return `${playerName(state.currentPlayer)}: place the ${colourName(state.assignedColour)} Opening Four piece on any empty 6×6 corner.`;
    }
    if (state.consequence?.type === "jump-choice" && state.choosingColour) return `${playerName(state.currentPlayer)}: choose which piece you will place after the Jump.`;
    if (state.choosingColour && state.finalFourPhase) return `${playerName(state.currentPlayer)}: choose a Final Four corner piece to place. No Move or Jump.`;
    if (state.choosingColour) return ordinaryReserveIndices(state.consequence?.heldIndex).length
      ? `${playerName(state.colourChooser)}: choose a reserve piece/colour for ${playerName(state.currentPlayer)}.`
      : "No ordinary reserve piece remains.";
    if (state.redeployPiece) return `${playerName(state.currentPlayer)}: place the jumped ${colourName(state.redeployPiece.colour)} piece on any empty square.`;
    if (state.consequence?.type === "move" && state.consequence.step === 2) return `${playerName(state.currentPlayer)}: now place the originally handed ${colourName(state.assignedColour)} piece on any empty square.`;
    if (!canMoveOrJump()) return `${playerName(state.currentPlayer)}: place the ${colourName(state.assignedColour)} piece on any empty square.`;
    return `${playerName(state.currentPlayer)}: Place, Move or Jump using ${colourName(state.assignedColour)}.`;
  }

  function renderPiece(colour, special=false, locked=false) {
    const s = document.createElement("span");
    s.className = `piece piece--${colour}${special ? " piece--special" : ""}${locked ? " piece--locked" : ""}`;
    return s;
  }

  function renderBoard() {
    boardEl.replaceChildren();
    const winning = new Set(state.winningCells);
    for (let d=0; d<64; d++) {
      const dr=Math.floor(d/8), dc=d%8, inner=dr>=1&&dr<=6&&dc>=1&&dc<=6;
      const btn=document.createElement("button"); btn.type="button"; btn.className="cell";
      btn.classList.add((dr+dc)%2 ? "dark" : "light");
      if (!inner) {
        btn.classList.add("reserve-cell");
        if (state.phase === "opening") btn.classList.add("reserve-cell--setup");
        const slot=CORNERS.indexOf(d), active=state.reserve.active[d], locked=state.reserve.locked[d];
        if (slot >= 0) {
          const special=state.reserve.locked[d];
          if(special){
            const piece=renderPiece(special,true,!state.finalFourPhase);
            btn.appendChild(piece);
            const choosingHeld = state.cornerPickFor !== null && !isComputer(state.cornerPickFor);
            const enabled=state.finalFourPhase && state.winner===null;
            if (choosingHeld) {
              btn.classList.add("selectable");piece.classList.add("piece--available-reserve");
              btn.addEventListener("click",()=>pickOpeningCorner(d));
            }
            if(enabled && state.choosingColour && !isComputer(state.colourChooser)){
              btn.classList.add("selectable");piece.classList.add("piece--available-reserve");
              btn.addEventListener("click",()=>chooseExactReserve(d));
            }
            if(enabled && !state.choosingColour && state.selectedReserveIndex===d)piece.classList.add("piece--active-reserve");
            btn.setAttribute("aria-label",`${colourName(special)} outside corner${choosingHeld?" — select to hold":enabled?" available for Final Four":" — waiting for endgame"}`);
          } else {
            if (state.cornerReturnFor !== null && !isComputer(state.cornerReturnFor)) {
              btn.classList.add("selectable", "place-target");
              btn.addEventListener("click",()=>returnCorner(d));
              btn.setAttribute("aria-label", "Empty outside corner: return your Move/Jump piece here");
            } else btn.setAttribute("aria-label","Outside corner empty");
          }
          boardEl.appendChild(btn);continue;
        }
        const openingTop = state.phase === "opening" ? state.openingReserve[d] : null;
        if (openingTop) {
          btn.classList.add("corner-stack");
          const bottom = renderPiece(locked, true, true);
          bottom.classList.add("piece--stack-bottom");
          btn.appendChild(bottom);
          const top = renderPiece(openingTop, true);
          top.classList.add("piece--stack-top");
          if (state.winner === null && !state.choosingColour && state.selectedOpeningIndex === d) top.classList.add("piece--active-reserve");
          btn.appendChild(top);
          btn.setAttribute("aria-label", `Two ${colourName(openingTop)} special pieces; top piece for Opening Four`);
          if (state.choosingColour && state.winner === null && !isComputer(state.colourChooser)) {
            btn.classList.add("selectable");
            top.classList.add("piece--available-reserve");
            btn.addEventListener("click", () => chooseExactReserve(d));
          }
          boardEl.appendChild(btn);
          continue;
        }
        if (active) {
          const held = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
          const available = activeReserveIndices(null, held).includes(d);
          const reservePiece = renderPiece(active, slot>=0, slot>=0 && !available);
          if (state.winner === null && !state.pendingSwap && !state.choosingColour && !state.redeployPiece && state.selectedReserveIndex === d) reservePiece.classList.add("piece--active-reserve");
          btn.appendChild(reservePiece);
          if (slot>=0) btn.title=available ? "Special: Place only; permanently fixed once placed" : "Special unavailable while ordinary reserve choices remain";
          if (state.winner===null && state.pendingSwap && available && !isComputer(state.pendingSwap.decider)) {
            btn.classList.add("selectable"); reservePiece.classList.add("piece--available-reserve");
            btn.setAttribute("aria-label", `Accept and select this ${colourName(active)} reserve piece`);
            btn.addEventListener("click",()=>resolveSwap(false,d));
          }
          if (state.winner===null && state.choosingColour && state.phase==="main" && !isComputer(state.colourChooser) && availableChoiceColours().includes(active)) {
            const held=state.consequence?.type==="move"?state.consequence.heldIndex:null;
            if (d!==held && available) { btn.classList.add("selectable"); reservePiece.classList.add("piece--available-reserve"); btn.addEventListener("click",()=>chooseExactReserve(d)); }
          }
        } else if (locked) {
          btn.appendChild(renderPiece(locked,true,true));
          btn.title="Locked corner — clear either adjoining edge to release it";
        } else btn.classList.add("empty-reserve");
        if (slot>=0 && state.releasedCorners[slot]) btn.classList.add("released-corner");
      } else {
        const r=dr-1,c=dc-1,index=r*6+c; btn.classList.add("play-cell");
        if (winning.has(index)) btn.classList.add("winner");
        if (state.phase==="opening" && ANCHORS.includes(index) && !state.board[index] && !state.choosingColour) {
          btn.classList.add("place-target", "opening-corner-target");
          btn.setAttribute("aria-label", `Place ${colourName(state.assignedColour)} Opening Four piece here`);
        }
        if (state.selectedBoardIndex===index) btn.classList.add("selected");
        if (state.legalMoves.has(index)) btn.classList.add("move-target");
        if (state.legalJumps.has(index)) btn.classList.add("jump-target");
        if (state.winner === null && !state.pendingSwap && state.phase==="main" && !state.choosingColour && state.selectedBoardIndex === null && !state.board[index] && (state.selectedReserveIndex!==null || state.redeployPiece)) btn.classList.add("place-target");
        const p=state.board[index];
        if (p) {
          const boardPiece=renderPiece(p.colour,p.special);
          if (state.winner===null && state.pendingSwap?.firstNormalIndex===index) boardPiece.classList.add("piece--active-reserve");
          btn.appendChild(boardPiece);
        }
        if (state.winner===null && state.pendingSwap?.firstNormalIndex===index && !isComputer(state.pendingSwap.decider)) {
          btn.setAttribute("aria-label", "Take position — keep the first ordinary piece here");
          btn.addEventListener("click",()=>resolveSwap(true));
        } else btn.addEventListener("click",()=>handleInner(index));
      }
      boardEl.appendChild(btn);
    }
  }

  function renderQualificationPanel() {
    for (let player=0;player<2;player++) {
      const held = state.heldCorners[player];
      const colour = state.qualificationCornerColours[player] || held?.colour || null;
      const returned = state.qualified[player] && !held;
      const token = el(`qualification-piece-${player}`);
      token.className = `piece piece--special qualification-token ${colour ? `piece--${colour}` : "qualification-token--unassigned"}${returned ? " qualification-token--returned" : ""}`;
      el(`qualification-name-${player}`).textContent = playerName(player);
      el(`qualification-status-${player}`).textContent = returned
        ? `${colour ? colourName(colour) + " · " : ""}Returned — can win`
        : state.qualified[player]
          ? "Move/Jump completed — return piece"
          : held ? `${colourName(held.colour)} · Move/Jump needed` : "Corner piece not yet chosen";
    }
  }

  function render() {
    applyColours();
    renderQualificationPanel();
    currentEl.textContent = state.winner===null ? playerName(decisionActor()) : "Game over";
    statusEl.textContent = statusText() + (match?.pendingCounter !== null && match?.pendingCounter !== undefined ? ` ${playerName(match.pendingCounter)}: ${match.ownerColours[match.pendingCounter]?`take a ${colourName(match.ownerColours[match.pendingCounter])} corner counter`:"choose your counter colour by taking any corner piece"}.` : "") + (state.lastReleaseMessage ? ` ${state.lastReleaseMessage}.` : "");
    renderMatch();
    state.lastReleaseMessage = "";

    const versionTitle = settings.version === "learning" ? "Learning" : settings.version === "extreme" ? "Standard" : "Easy";
    el("quick-rules-title").textContent = `Lipfty · ${versionTitle}`;
    el("quick-win-rule").innerHTML = settings.version === "extreme"
      ? "<strong>Win:</strong> Move/Jump first, then four in a line or Square."
      : "<strong>Win:</strong> Move/Jump first, then four in a line.";
    const status = state.qualified.map((q,p)=> {
      const held=state.heldCorners[p];
      return `${playerName(p)}: ${held ? `${colourName(held.colour)} special held${q?" — returning":" — Move/Jump needed"}` : q?"Move/Jump completed":"selecting a special — Move/Jump required"}`;
    }).join(" · ");
    el("phase-help").textContent = state.finalFourPhase ? `Final Four · ${activeReserveIndices().length} pieces remain · Place only` : `${ordinaryReserveIndices().length} ordinary pieces remain · ${status}`;
    const consequence = state.consequence;
    const compulsory = consequence
      ? (consequence.type === "move" ? (consequence.step === 1 ? 2 : 1)
        : ["jump-choice", "jump-redeploy-first", "jump-held-first"].includes(consequence.type) ? 2 : 1)
      : 0;
    el("placement-alert").hidden = compulsory === 0 || state.winner !== null;
    el("placement-alert").textContent = `COMPULSORY PLACEMENT · ${compulsory} remaining`;

    blackBtn.querySelector("strong").textContent=colourName("black");
    whiteBtn.querySelector("strong").textContent=colourName("white");
    const excludeHeld = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    const blackCount = activeReserveIndices("black",excludeHeld).length;
    const whiteCount = activeReserveIndices("white",excludeHeld).length;
    blackBtn.querySelector("small").textContent=`${blackCount} available`;
    whiteBtn.querySelector("small").textContent=`${whiteCount} available`;
    blackBtn.disabled = !state.choosingColour || isComputer(state.colourChooser) || !availableChoiceColours().includes("black") || !!state.pendingSwap || state.cornerPickFor !== null || state.cornerReturnFor !== null;
    whiteBtn.disabled = !state.choosingColour || isComputer(state.colourChooser) || !availableChoiceColours().includes("white") || !!state.pendingSwap || state.cornerPickFor !== null || state.cornerReturnFor !== null;
    blackBtn.querySelector(".mini-piece").style.background=colourCss("black");
    whiteBtn.querySelector(".mini-piece").style.background=colourCss("white");

    // A fixed colour is an instruction, even though its button cannot be clicked.
    const activeColour = state.winner === null && !state.pendingSwap && !state.choosingColour
      ? (state.redeployPiece?.colour || state.assignedColour) : null;
    const jumpChoice = state.consequence?.type === "jump-choice" && state.choosingColour;
    el("reserve-heading").textContent = state.winner !== null ? "Colours"
      : state.pendingSwap ? "Position decision"
      : state.cornerPickFor !== null || state.cornerReturnFor !== null ? "Outside corner decision"
      : state.choosingColour ? (jumpChoice ? "Choose piece to place" : "Choose a colour")
      : "Colour to use";
    for (const [colour, button] of [["black", blackBtn], ["white", whiteBtn]]) {
      const required = activeColour === colour;
      button.classList.toggle("reserve-button--required", required);
      button.classList.toggle("reserve-button--opening-available",
        state.phase === "opening" && state.winner === null && state.openingRemaining[colour] > 0);
      button.setAttribute("aria-label", `${colourName(colour)}${required ? ": colour to use" : ""}`);
      button.querySelector(".mini-piece").classList.toggle("piece--special",
        state.phase === "opening" || (required && !!state.redeployPiece?.special) ||
        (required && state.selectedReserveIndex !== null && CORNERS.includes(state.selectedReserveIndex)));
      if (required) button.querySelector("small").textContent = state.redeployPiece
        ? "Place jumped piece" : state.phase === "opening" ? "Place Opening Four piece"
        : canMoveOrJump() ? "Use this colour" : "Place this piece";
      else if (jumpChoice) button.querySelector("small").textContent =
        colour === state.consequence.heldColour ? "Originally handed piece" : "Jumped piece";
    }

    reserveInfoEl.textContent = state.cornerPickFor !== null ? "Choose a shaped outside corner piece to hold. Your first Move or Jump returns it to an empty corner."
      : state.cornerReturnFor !== null ? "Your Move/Jump is complete. Select an empty outside corner for your held piece."
      : state.pendingSwap
      ? "Click the flashing board piece to Take position, or an available outside piece to Accept and select it to play next. The first placement stays where it is."
      : state.phase === "opening"
      ? "Two same-colour special pieces at each outside corner. The chosen top piece flashes; dots mark where it can be placed."
      : state.redeployPiece ? `Place the jumped ${colourName(state.redeployPiece.colour)} piece on a dotted square.`
      : state.finalFourPhase ? "Final Four: choose a shaped corner piece and place it. No Move or Jump."
      : "Complete one Move or Jump before you can win. Your special piece returns after its compulsory placements. Otherwise use the handed colour to Place, Move or Jump.";

    swapBox.hidden = !state.pendingSwap || isComputer(state.pendingSwap?.decider);
    jumpChoiceBox.hidden = !(state.consequence?.type === "jump-choice" && state.choosingColour && !isComputer(state.colourChooser));
    if (!jumpChoiceBox.hidden) {
      const c=state.consequence;
      el("choose-handed").textContent=`Place handed ${colourName(c.heldColour)}`;
      el("choose-jumped").textContent=`Place jumped ${colourName(c.jumpedPiece.colour)}`;
    }
    undoBtn.disabled = !canUndo();
    renderBoard();
  }

  function gameIsInProgress(){
    if (match && (match.pendingCounter !== null || (match.winner === null && match.scores.some(score=>score>0)))) return true;
    return !!state && state.winner === null && (state.openingPlaced > 0 || state.board.some(Boolean) || ordinaryReserveIndices().length < 24);
  }
  function matchLength() { return [1,3,5].includes(settings.matchLength) ? settings.matchLength : 5; }
  function cloneMatch() { return match ? {...match,scores:[...match.scores],takenCounters:[...match.takenCounters],cornerColours:[...match.cornerColours],ownerColours:[...match.ownerColours]} : null; }
  function takeCounter(slot, redraw = true) {
    if (!match || match.pendingCounter === null || match.takenCounters[slot] !== null || !Number.isInteger(slot) || slot < 0 || slot > 3) return;
    const winner=match.pendingCounter, colour=match.cornerColours[slot];
    if(match.ownerColours[winner] && match.ownerColours[winner]!==colour) return;
    if(!match.ownerColours[winner]) {
      match.ownerColours[winner]=colour;
      match.ownerColours[other(winner)]=colour==="black"?"white":"black";
    }
    match.takenCounters[slot]=winner;
    match.pendingCounter=null;
    if (redraw) { render(); maybeOfferUpdate(); }
  }
  function takeCounterForMatch(winner,slot){
    if(!match.ownerColours[winner]){
      const colour=match.cornerColours[slot];
      match.ownerColours[winner]=colour;
      match.ownerColours[other(winner)]=colour==="black"?"white":"black";
    }
    match.takenCounters[slot]=winner;
  }
  function recordMatchResult() {
    if (!match || state.winner === "draw") return;
    const winner=state.winner;
    match.scores[winner]++;
    if (match.scores[winner] >= (matchLength()+1)/2) match.winner=winner;
    const free=match.takenCounters.map((owner,i)=>owner===null&&(!match.ownerColours[winner]||match.cornerColours[i]===match.ownerColours[winner])?i:null).filter(i=>i!==null);
    // v17: physical corner pieces are for play, so score markers are virtual.
    // Record score without requiring the winner to remove a game piece.
    if (free.length) takeCounterForMatch(winner,free[0]);
  }
  function nextMatchGame() {
    if (!match || state.winner === null || match.pendingCounter !== null || match.winner !== null) return;
    clearTimeout(timer); history=[]; resultRecorded=false; recordedResult=null; nextPieceId=1;
    if (state.winner !== "draw") match.gameNumber++;
    match.starter=other(match.starter);
    state=freshState(match.starter);
    initialiseClock(); render(); processFlow();
  }
  function renderMatch() {
    if (!match) return;
    const length=matchLength(), target=(length+1)/2;
    const deciding=match.scores.every(score=>score===target-1);
    const format=length===1?"Single game":`Best of ${length}`;
    el("match-score").textContent=`${playerName(0)} ${match.scores[0]} – ${match.scores[1]} ${playerName(1)}`;
    el("match-progress").textContent=match.winner!==null ? `${playerName(match.winner)} wins ${length===1?"the game":"the match"}!`
      : state.winner==="draw" ? `${format} · Draw — replay game ${match.gameNumber}`
      : state.winner!==null ? `${format} · Game ${match.gameNumber} complete`
      : length>1&&deciding ? `${format} · Deciding game` : `${format} · Game ${match.gameNumber}`;
    const next=el("next-game");
    next.hidden=state.winner===null||match.winner!==null;
    next.disabled=match.pendingCounter!==null;
    const ownership=match.ownerColours[0]?` · ${playerName(0)} collects ${colourName(match.ownerColours[0])}; ${playerName(1)} collects ${colourName(match.ownerColours[1])}`:" · First winner chooses their counter colour";
    el("match-progress").textContent+=ownership;
    next.textContent=state.winner==="draw"?"Replay game":"Next game";
    el("new-game").textContent=length===1?"New game":"New match";
    // Finish the winner's counter choice before starting another contest.
    el("new-game").disabled=match.pendingCounter!==null;
  }
  function renderCornerCounter(button,slot) {
    const owner=match?.takenCounters[slot]??null;
    const colour=match?.cornerColours[slot]||(["black","white","white","black"][slot]);
    const chooser=match?.pendingCounter;
    const available=!!match && chooser!==null && owner===null && (!match.ownerColours[chooser]||match.ownerColours[chooser]===colour);
    button.classList.add("corner-counter");
    const label=owner===null?`${colourName(colour)} win counter — never enters play`:`${colourName(colour)} counter taken by ${playerName(owner)}`;
    if(owner===null){
      const counter=renderPiece(colour,true);button.appendChild(counter);
      if(available&&!isComputer(chooser))counter.classList.add("piece--available-reserve");
    }
    button.title=label;button.setAttribute("aria-label",available?`${playerName(chooser)}: take this ${colourName(colour)} win counter`:label);
    if(available&&!isComputer(chooser)){button.classList.add("selectable");button.addEventListener("click",()=>takeCounter(slot));}
    else button.disabled=true;
  }

  function startGame() {
    clearTimeout(timer); resultRecorded=false; recordedResult=null; nextPieceId=1; history=[]; state=freshState();
    match={scores:[0,0],takenCounters:[null,null,null,null],cornerColours:shuffled(["black","black","white","white"]),ownerColours:[null,null],pendingCounter:null,winner:null,starter:state.openingChooser,gameNumber:1};
    applyColours(); initialiseClock(); render(); processFlow();
  }

  function playTone(kind="move") {
    if (!settings.sound || !("AudioContext" in window || "webkitAudioContext" in window)) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      const frequencies = { select: 320, place: 380, move: 440, jump: 520, win: 660 };
      const duration = kind === "win" ? .22 : kind === "jump" ? .14 : .08;
      osc.frequency.value = frequencies[kind] || frequencies.select;
      gain.gain.setValueAtTime(.025, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
      osc.addEventListener("ended", () => ctx.close());
    } catch (_) {}
  }

  function clockEnabled(){ return Number(settings.clockMinutes) > 0; }
  function decisionActor(){ if (!state || state.winner!==null) return null; if(state.pendingSwap) return state.pendingSwap.decider; if(state.cornerPickFor!==null) return state.cornerPickFor; if(state.cornerReturnFor!==null) return state.cornerReturnFor; return state.choosingColour ? state.colourChooser : state.currentPlayer; }
  function formatClock(ms){ const total=Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`; }
  function stopClock(){ if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null; renderClocks(); }
  function settleClock(now=Date.now()){
    if(!clockEnabled() || clockActivePlayer===null || clockLastTick===null || state?.winner!==null) return null;
    const elapsed=Math.max(0,now-clockLastTick); clockRemainingMs[clockActivePlayer]=Math.max(0,clockRemainingMs[clockActivePlayer]-elapsed); clockLastTick=now;
    return clockRemainingMs[clockActivePlayer] <= 0 ? clockActivePlayer : null;
  }
  function initialiseClock(){ if(clockInterval) clearInterval(clockInterval); const initial=clockEnabled()?Number(settings.clockMinutes)*60000:0; clockRemainingMs=[initial,initial]; clockActivePlayer=null; clockLastTick=null; renderClocks(); }
  function restoreClock(snap){ if(clockInterval) clearInterval(clockInterval); clockInterval=null; const initial=clockEnabled()?Number(settings.clockMinutes)*60000:0; clockRemainingMs=snap?.remainingMs?[...snap.remainingMs]:[initial,initial]; clockActivePlayer=Number.isInteger(snap?.activePlayer)?snap.activePlayer:null; clockLastTick=clockActivePlayer===null?null:Date.now(); }
  function finishTimeLoss(expired){
    if(!state || state.winner!==null) return;
    clockRemainingMs[expired]=0; state.winner=other(expired); state.winType="time"; state.choosingColour=false;
    if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null;
    maybeRecordResult(); playTone("win"); render(); maybeOfferUpdate();
  }
  function syncClock(){
    if(!clockEnabled()){ if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null; renderClocks(); return; }
    const now=Date.now(), expired=settleClock(now); if(expired!==null){finishTimeLoss(expired);return;}
    const next=decisionActor(); if(next!==clockActivePlayer){ if(clockActivePlayer!==null) clockRemainingMs[clockActivePlayer]+=Math.max(0,Number(settings.clockIncrement)||0)*1000; clockActivePlayer=next; }
    clockLastTick=clockActivePlayer===null?null:now;
    if(!clockInterval && clockActivePlayer!==null) clockInterval=setInterval(()=>{const e=settleClock(); if(e!==null) finishTimeLoss(e); else renderClocks();},250);
    renderClocks();
  }
  function renderClocks(){
    const panel=el("chess-clocks"), row=document.querySelector(".turn-status-row"); if(!panel) return; const enabled=clockEnabled(); panel.hidden=!enabled; row?.classList.toggle("chess-clock-enabled",enabled); if(!enabled) return;
    for(let p=0;p<2;p++){ el(`clock-player-${p}-name`).textContent=playerName(p); el(`clock-player-${p}`).textContent=formatClock(clockRemainingMs[p]); const card=panel.querySelector(`[data-clock-player="${p}"]`); card?.classList.toggle("chess-clock-card--active",clockActivePlayer===p&&state?.winner===null); card?.classList.toggle("chess-clock-card--expired",clockRemainingMs[p]<=0); }
  }

  const STATS_KEY="lipfty14-stats";
  function emptyStats(){return{computer:{played:0,won:0,lost:0,drawn:0},two:{played:0,p1:0,p2:0,drawn:0}};}
  function loadStats(){try{const x=JSON.parse(localStorage.getItem(STATS_KEY)||"null"),b=emptyStats();return x?{computer:{...b.computer,...x.computer},two:{...b.two,...x.two}}:b;}catch(_){return emptyStats();}}
  function maybeRecordResult(){
    if(resultRecorded||state?.winner===null)return; resultRecorded=true; recordMatchResult(); const stats=loadStats();
    const group=settings.mode==="computer"?"computer":"two";
    const outcome=state.winner==="draw"?"drawn":group==="computer"?(state.winner===0?"won":"lost"):(state.winner===0?"p1":"p2");
    stats[group].played++; stats[group][outcome]++;
    try{localStorage.setItem(STATS_KEY,JSON.stringify(stats)); recordedResult={group,outcome};}catch(_){}
  }
  function rollbackResult(){
    if(recordedResult){
      const stats=loadStats(),{group,outcome}=recordedResult;
      stats[group].played=Math.max(0,stats[group].played-1);
      stats[group][outcome]=Math.max(0,stats[group][outcome]-1);
      try{localStorage.setItem(STATS_KEY,JSON.stringify(stats));}catch(_){}
    }
    recordedResult=null; resultRecorded=false;
  }
  function renderStatistics(){const stats=loadStats(),box=el("statistics-content"),tile=(v,l)=>`<span><strong>${v}</strong><small>${l}</small></span>`;box.innerHTML=`<h3>Against the computer</h3><div class="statistics-summary">${tile(stats.computer.played,"Played")}${tile(stats.computer.won,"You won")}${tile(stats.computer.lost,"Computer won")}${tile(stats.computer.drawn,"Draws")}</div><h3>Two players</h3><div class="statistics-summary">${tile(stats.two.played,"Played")}${tile(stats.two.p1,"Player 1 won")}${tile(stats.two.p2,"Player 2 won")}${tile(stats.two.drawn,"Draws")}</div>`;}

  function jumpToEndTest(){
    clearTimeout(timer); resultRecorded=false; recordedResult=null; nextPieceId=1; history=[]; state=freshState();
    state.phase="main"; state.openingPlaced=4; state.openingRemaining={black:0,white:0}; state.swapDone=true;
    state.board=Array(36).fill(null);
    const fallback=[[1,"black"],[2,"white"],[3,"white"],[4,"black"],[8,"black"],[11,"white"],[12,"black"],[14,"white"],[15,"black"],[16,"black"],[17,"white"],[19,"black"],[20,"black"],[21,"white"],[22,"white"],[23,"black"],[24,"white"],[25,"white"],[26,"white"],[27,"black"],[29,"white"],[31,"black"],[33,"black"],[34,"white"]];
    fallback.slice(2).forEach(([i,c])=>state.board[i]={id:nextPieceId++,colour:c,pinned:false,special:false,anchor:false});
    state.reserve.active.fill(null); state.reserve.active[1]="black"; state.reserve.active[2]="white";
    state.currentPlayer=0; state.colourChooser=0; state.choosingColour=true; state.assignedColour=null; state.selectedReserveIndex=null;
    match={scores:[0,0],takenCounters:[null,null,null,null],cornerColours:shuffled(["black","black","white","white"]),ownerColours:[null,null],pendingCounter:null,winner:null,starter:0,gameNumber:1};
    initialiseClock(); render(); processFlow();
  }

  blackBtn.addEventListener("click",()=>{playTone("select");chooseColour("black");});
  whiteBtn.addEventListener("click",()=>{playTone("select");chooseColour("white");});
  el("carry-on").addEventListener("click",()=>resolveSwap(false));
  el("swap-sides").addEventListener("click",()=>resolveSwap(true));
  el("choose-handed").addEventListener("click",()=>applyJumpChoice(state.consequence.heldColour));
  el("choose-jumped").addEventListener("click",()=>applyJumpChoice(state.consequence.jumpedPiece.colour));
  el("new-game").addEventListener("click",startGame);
  el("next-game").addEventListener("click",nextMatchGame); undoBtn.addEventListener("click",undo);

  let versionTaps=[]; function handleVersionTap(){const now=Date.now();versionTaps=versionTaps.filter(t=>now-t<=3000);versionTaps.push(now);if(versionTaps.length>=5){versionTaps=[];jumpToEndTest();}}
  [el("app-version"),el("mobile-version")].filter(Boolean).forEach(x=>x.addEventListener("click",handleVersionTap));

  const settingsDialog=el("settings-dialog"),settingsForm=el("settings-form"),wizardSteps=[...document.querySelectorAll("[data-wizard-step]")],wizardIndicators=[...document.querySelectorAll("[data-step-indicator]")];
  const wizardBack=el("wizard-back"),wizardNext=el("wizard-next"),wizardSave=el("wizard-save"),wizardDefault=el("wizard-default"); let wizardStep=0;
  const colourOptions=["red","blue","green","yellow","purple","orange","black","white"];
  function buildColours(id,name){const box=el(id);box.replaceChildren();for(const k of colourOptions){const l=document.createElement("label");l.className="colour-choice";l.innerHTML=`<input type="radio" name="${name}" value="${k}"><span><i class="colour-swatch" style="background:${COLOURS[k][1]}"></i>${COLOURS[k][0]}</span>`;box.appendChild(l);}}
  buildColours("colour1-choices","colour1");buildColours("colour2-choices","colour2");
  function fv(n){return settingsForm.querySelector(`[name="${n}"]:checked`)?.value;} function sr(n,v){const x=settingsForm.querySelector(`[name="${n}"][value="${v}"]`);if(x)x.checked=true;}
  function syncMode(){const one=fv("gameMode")==="computer";el("difficulty-field").hidden=!one;el("player2-label").hidden=one;el("player1-label-text").textContent=one?"Player name":"Player 1 name";el("starter-player-label").textContent=one?"Player":"Player 1";el("starter-other-label").textContent=one?"Computer":"Player 2";}
  function syncDifficulty(){const n=Number(el("difficulty-input").value),names=["","Beginner","Standard","Expert"];el("difficulty-name").textContent=`${n} · ${names[n]}`;}
  function syncClockOptions(){const enabled=Number(fv("clockMinutes")||0)>0;el("clock-increment-field").disabled=!enabled;if(!enabled)sr("clockIncrement","0");}
  function showStep(n){wizardStep=Math.max(0,Math.min(5,n));wizardSteps.forEach((x,i)=>x.hidden=i!==wizardStep);wizardIndicators.forEach((x,i)=>{x.classList.toggle("wizard-progress-step--active",i===wizardStep);x.classList.toggle("wizard-progress-step--complete",i<wizardStep);});wizardDefault.hidden=wizardStep!==0;wizardBack.hidden=wizardStep===0;wizardNext.hidden=wizardStep===5;wizardSave.hidden=false;if(wizardStep===5)summary();}
  function summary(){const one=fv("gameMode")==="computer",mins=Number(fv("clockMinutes")||0),inc=Number(fv("clockIncrement")||0),clock=mins?`${mins} min each${inc?` + ${inc}s`:""}`:"Clock off";el("setup-summary").textContent=`Lipfty · ${one?"Player vs Computer":"Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${({learning:"Learning",standard:"Easy",extreme:"Standard"})[fv("gameVersion")||"standard"]} · ${Number(fv("matchLength"))===1?"Single game":`Best of ${fv("matchLength")||5}`} · ${clock}`;}
  function loadForm(){sr("gameMode",settings.mode);el("difficulty-input").value=settings.level==="beginner"?1:settings.level==="expert"?3:2;sr("allowUndo",settings.undo?"yes":"no");sr("colour1",settings.colour1);sr("colour2",settings.colour2);sr("gameVersion",settings.version);sr("matchLength",String(settings.matchLength));el("setting-player1").value=settings.player1||"Player";el("setting-player2").value=settings.player2||"Player 2";sr("starter",settings.starter);sr("clockMinutes",String(settings.clockMinutes||0));sr("clockIncrement",String(settings.clockIncrement||0));el("setting-sound").checked=settings.sound!==false;el("setting-animations").checked=settings.animations!==false;el("setting-language").value=settings.language||"en-GB";syncMode();syncDifficulty();syncClockOptions();showStep(0);}
  function setDefaultForm(){
    const d=defaultSettings();
    sr("gameMode",d.mode); el("difficulty-input").value=d.level==="beginner"?1:d.level==="expert"?3:2;
    sr("allowUndo",d.undo?"yes":"no"); sr("colour1",d.colour1); sr("colour2",d.colour2); sr("gameVersion",d.version); sr("matchLength",String(d.matchLength));
    el("setting-player1").value=d.player1; el("setting-player2").value=d.player2; sr("starter",d.starter);
    sr("clockMinutes",String(d.clockMinutes)); sr("clockIncrement",String(d.clockIncrement));
    el("setting-sound").checked=d.sound; el("setting-animations").checked=d.animations; el("setting-language").value=d.language;
    syncMode(); syncDifficulty(); syncClockOptions();
  }
  function commitSettings(){const c1=fv("colour1"),c2=fv("colour2");if(!c1||!c2||c1===c2){showStep(1);statusEl.textContent="Choose two different piece colours.";return false;}const n=Number(el("difficulty-input").value);settings={...settings,mode:fv("gameMode"),level:n===1?"beginner":n===3?"expert":"standard",version:fv("gameVersion")||"standard",matchLength:[1,3,5].includes(Number(fv("matchLength")))?Number(fv("matchLength")):5,starter:fv("starter")||"random",player1:el("setting-player1").value.trim()||"Player",player2:el("setting-player2").value.trim()||"Player 2",colour1:c1,colour2:c2,clockMinutes:Number(fv("clockMinutes")||0),clockIncrement:Number(fv("clockIncrement")||0),sound:el("setting-sound").checked,animations:el("setting-animations").checked,language:el("setting-language").value,undo:fv("allowUndo")==="yes",colourDefaultsVersion:1403};saveSettings();settingsDialog.close();startGame();return true;}
  el("settings-button").addEventListener("click",()=>{loadForm();settingsDialog.showModal();});el("close-settings").addEventListener("click",()=>settingsDialog.close());wizardBack.addEventListener("click",()=>showStep(wizardStep-1));wizardNext.addEventListener("click",()=>{if(wizardStep===1&&fv("colour1")===fv("colour2")){statusEl.textContent="Choose two different piece colours.";return;}showStep(wizardStep+1);});wizardDefault.addEventListener("click",setDefaultForm);settingsForm.addEventListener("submit",e=>{e.preventDefault();commitSettings();});
  wizardIndicators.forEach((x,i)=>{x.setAttribute("role","button");x.tabIndex=0;x.addEventListener("click",()=>showStep(i));x.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();showStep(i);}});});
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(x=>x.addEventListener("change",syncMode));el("difficulty-input").addEventListener("input",syncDifficulty);settingsForm.querySelectorAll('[name="clockMinutes"]').forEach(x=>x.addEventListener("change",syncClockOptions));

  el("help-button").addEventListener("click",()=>el("help-dialog").showModal());el("close-help").addEventListener("click",()=>el("help-dialog").close());
  el("view-statistics-button").addEventListener("click",()=>{renderStatistics();el("statistics-dialog").showModal();});el("close-statistics").addEventListener("click",()=>el("statistics-dialog").close());el("reset-statistics").addEventListener("click",()=>{if(confirm("Reset all Lipfty statistics on this device?")){localStorage.removeItem(STATS_KEY);renderStatistics();}});

  fetch("./build-info.json",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(info=>{const v=info?.version||"16.0.4";el("app-version").textContent=`Version ${v}`;el("mobile-version").textContent=`v${v}`;const ref=info?.commit||info?.gitCommit||"";el("build-reference").textContent=ref?` · ${String(ref).slice(0,7)}`:"";}).catch(()=>{el("app-version").textContent="Version 16.0.4";});
  let pendingUpdateRegistration = null;
  let updatePromptHandled = false;
  let reloadingForUpdate = false;
  function maybeOfferUpdate(){
    const registration = pendingUpdateRegistration;
    if (updatePromptHandled || !registration?.waiting || gameIsInProgress()) return;
    updatePromptHandled = true;
    if (confirm("A new version of Lipfty is available. Update now?")) {
      registration.waiting.postMessage({type:"SKIP_WAITING"});
    }
  }
  function registerServiceWorker(){
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
    navigator.serviceWorker.register("service-worker.js",{scope:"./"}).then(registration=>{
      const rememberWaiting = () => { pendingUpdateRegistration = registration; maybeOfferUpdate(); };
      if (registration.waiting) rememberWaiting();
      registration.addEventListener("updatefound",()=>{
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange",()=>{
          if (worker.state === "installed" && navigator.serviceWorker.controller) rememberWaiting();
        });
      });
    }).catch(()=>{});
  }

  registerServiceWorker();
  startGame();
})();





