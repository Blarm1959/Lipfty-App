(function () {
  "use strict";

  const SIZE = 6;
  const WIN_LENGTH = 4;

  function indexOf(r, c) { return r * SIZE + c; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function buildStraightLines(directions) {
    const lines = [];

    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        for (const [dr, dc] of directions) {
          const endR = r + dr * (WIN_LENGTH - 1);
          const endC = c + dc * (WIN_LENGTH - 1);
          if (!inBounds(endR, endC)) continue;

          const line = [];
          for (let step = 0; step < WIN_LENGTH; step += 1) {
            line.push(indexOf(r + dr * step, c + dc * step));
          }
          lines.push(line);
        }
      }
    }

    return lines;
  }

  function buildAxisAlignedSquares() {
    const squares = [];
    for (let side = 1; side < SIZE; side += 1) {
      for (let r = 0; r + side < SIZE; r += 1) {
        for (let c = 0; c + side < SIZE; c += 1) {
          squares.push([
            indexOf(r, c),
            indexOf(r, c + side),
            indexOf(r + side, c + side),
            indexOf(r + side, c)
          ]);
        }
      }
    }
    return squares;
  }

  function buildDiagonalSquares() {
    const squares = [];
    for (let radius = 1; radius < SIZE; radius += 1) {
      for (let centreR = radius; centreR + radius < SIZE; centreR += 1) {
        for (let centreC = radius; centreC + radius < SIZE; centreC += 1) {
          squares.push([
            indexOf(centreR - radius, centreC),
            indexOf(centreR, centreC + radius),
            indexOf(centreR + radius, centreC),
            indexOf(centreR, centreC - radius)
          ]);
        }
      }
    }
    return squares;
  }

  const ORTHOGONAL_LINES = buildStraightLines([[0, 1], [1, 0]]);
  const DIAGONAL_LINES = buildStraightLines([[1, 1], [1, -1]]);
  const WINNING_LINES = [...ORTHOGONAL_LINES, ...DIAGONAL_LINES];
  const AXIS_ALIGNED_SQUARES = buildAxisAlignedSquares();
  const TIGHT_SQUARES = AXIS_ALIGNED_SQUARES.filter(pattern => {
    const a = pattern[0], b = pattern[1];
    return Math.abs(col(b) - col(a)) === 1;
  });
  const TIGHT_DIAMONDS = buildDiagonalSquares().filter(pattern => {
    const a = pattern[0], b = pattern[1];
    return Math.abs(row(b) - row(a)) === 1;
  });
  const WINNING_SQUARES = AXIS_ALIGNED_SQUARES;
  const WINNING_DIAMONDS = buildDiagonalSquares();
  const WINNING_PATTERNS = [...WINNING_LINES, ...WINNING_SQUARES, ...WINNING_DIAMONDS];

  function row(index) { return Math.floor(index / SIZE); }
  function col(index) { return index % SIZE; }

  function checkWin(board, options = {}) {
    const rules = options && typeof options === "object" ? options : {};
    const patterns = [...ORTHOGONAL_LINES];
    if (rules.allowDiagonal) patterns.push(...DIAGONAL_LINES);
    if (rules.allowSquare) patterns.push(...TIGHT_SQUARES);
    if (rules.allowSquare && rules.allowSpacedSquare) patterns.push(...AXIS_ALIGNED_SQUARES);
    if (rules.allowDiamond) patterns.push(...TIGHT_DIAMONDS);
    if (rules.allowDiamond && rules.allowSpacedDiamond) patterns.push(...WINNING_DIAMONDS);
    for (const pattern of patterns) {
      const pieces = pattern.map(index => board[index]);
      if (pieces.some(piece => !piece)) continue;
      const colour = pieces[0].colour;
      if (pieces.every(piece => piece.colour === colour)) return { line: [...pattern], colour };
    }
    return null;
  }

  function availableReserveColours(remainingByColour, colours = ["black", "white"]) {
    return colours.filter(colour => Number(remainingByColour?.[colour] || 0) > 0);
  }

  function adjacentDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) {
          const to = indexOf(nr, nc);
          if (!board[to]) result.push(to);
        }
      }
    }
    return result;
  }

  function jumpDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const overR = r + dr, overC = c + dc;
        const landR = r + dr * 2, landC = c + dc * 2;
        if (!inBounds(overR, overC) || !inBounds(landR, landC)) continue;
        const over = indexOf(overR, overC), to = indexOf(landR, landC);
        if (board[over] && !board[to]) result.push({ to, over });
      }
    }
    return result;
  }

  window.LipftyRules = { SIZE, WIN_LENGTH, WINNING_LINES, WINNING_SQUARES, WINNING_DIAMONDS, WINNING_PATTERNS, checkWin, availableReserveColours, adjacentDestinations, jumpDestinations };
})();
