import type Phaser from 'phaser';

import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/constants';
import type { SportType } from '../config/constants';

const LINE_COLOR = 0xe2e8f0;
const LINE_ALPHA = 0.85;
const LINE_WIDTH = 3;

/** Real-world field/court/pool lengths (metres), used only to scale line positions to the arena. */
const FIELD_LENGTH_M: Record<SportType, number> = {
  soccer: 105,
  basketball: 28,
  waterpolo: 30,
};

function pixelsPerMetre(sport: SportType): number {
  return ARENA_WIDTH / FIELD_LENGTH_M[sport];
}

function halfwayLine(graphics: Phaser.GameObjects.Graphics): void {
  const x = ARENA_WIDTH / 2;
  graphics.lineBetween(x, 0, x, ARENA_HEIGHT);
}

function centreCircle(graphics: Phaser.GameObjects.Graphics, radiusPx: number): void {
  graphics.strokeCircle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, radiusPx);
}

/** A short line across the goal/basket mouth, centred on the midline. */
function goalMouth(graphics: Phaser.GameObjects.Graphics, x: number, widthPx: number): void {
  const half = widthPx / 2;
  const cy = ARENA_HEIGHT / 2;
  graphics.lineBetween(x, cy - half, x, cy + half);
}

function drawSoccer(graphics: Phaser.GameObjects.Graphics): void {
  const ppm = pixelsPerMetre('soccer');
  const cy = ARENA_HEIGHT / 2;

  halfwayLine(graphics);
  centreCircle(graphics, 9.15 * ppm);

  const penaltyDepth = 16.5 * ppm;
  const penaltyWidth = 40.32 * ppm;
  const sixYardDepth = 5.5 * ppm;
  const sixYardWidth = 18.32 * ppm;
  const goalWidth = 7.32 * ppm;

  for (const isLeft of [true, false]) {
    const goalX = isLeft ? 0 : ARENA_WIDTH;

    graphics.strokeRect(
      isLeft ? 0 : ARENA_WIDTH - penaltyDepth,
      cy - penaltyWidth / 2,
      penaltyDepth,
      penaltyWidth,
    );
    graphics.strokeRect(
      isLeft ? 0 : ARENA_WIDTH - sixYardDepth,
      cy - sixYardWidth / 2,
      sixYardDepth,
      sixYardWidth,
    );
    goalMouth(graphics, goalX, goalWidth);
  }
}

function drawBasketball(graphics: Phaser.GameObjects.Graphics): void {
  const ppm = pixelsPerMetre('basketball');
  const cy = ARENA_HEIGHT / 2;

  halfwayLine(graphics);
  centreCircle(graphics, 1.8 * ppm);

  const keyDepth = 5.8 * ppm;
  const keyWidth = 4.9 * ppm;
  const freeThrowRadius = 1.8 * ppm;
  const hoopWidth = 1.8 * ppm;

  for (const isLeft of [true, false]) {
    const keyOriginX = isLeft ? 0 : ARENA_WIDTH - keyDepth;
    const freeThrowX = isLeft ? keyDepth : ARENA_WIDTH - keyDepth;

    graphics.strokeRect(keyOriginX, cy - keyWidth / 2, keyDepth, keyWidth);
    graphics.strokeCircle(freeThrowX, cy, freeThrowRadius);
    goalMouth(graphics, isLeft ? 0 : ARENA_WIDTH, hoopWidth);
  }
}

/** 2m and 5m lines traditionally show as red and yellow in a real pool; the goal line stays white. */
function drawWaterPolo(graphics: Phaser.GameObjects.Graphics): void {
  const ppm = pixelsPerMetre('waterpolo');
  const goalWidth = 3 * ppm;

  graphics.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA);
  halfwayLine(graphics);

  for (const isLeft of [true, false]) {
    const twoMetreX = isLeft ? 2 * ppm : ARENA_WIDTH - 2 * ppm;
    const fiveMetreX = isLeft ? 5 * ppm : ARENA_WIDTH - 5 * ppm;

    graphics.lineStyle(LINE_WIDTH, 0xef4444, LINE_ALPHA);
    graphics.lineBetween(twoMetreX, 0, twoMetreX, ARENA_HEIGHT);

    graphics.lineStyle(LINE_WIDTH, 0xfacc15, LINE_ALPHA);
    graphics.lineBetween(fiveMetreX, 0, fiveMetreX, ARENA_HEIGHT);

    graphics.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA);
    goalMouth(graphics, isLeft ? 0 : ARENA_WIDTH, goalWidth);
  }
}

/** Redraws the sport-specific markings onto an already-cleared graphics object. */
export function drawFieldMarkings(graphics: Phaser.GameObjects.Graphics, sport: SportType): void {
  graphics.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA);

  switch (sport) {
    case 'soccer':
      drawSoccer(graphics);
      return;
    case 'basketball':
      drawBasketball(graphics);
      return;
    case 'waterpolo':
      drawWaterPolo(graphics);
      return;
  }
}
