import coolantPurge from './coolantPurge.js';
import wireSplice from './wireSplice.js';
import spectrometer from './spectrometer.js';
import cargoSort from './cargoSort.js';
import airlockPressurize from './airlockPressurize.js';
import identScan from './identScan.js';
import debrisClear from './debrisClear.js';
import seedCatalogue from './seedCatalogue.js';
import dataUpload from './dataUpload.js';
import reactorCalibrate from './reactorCalibrate.js';
import { lightsFix, commsFix, reactorHold, o2Code } from './fixes.js';

export const MINIGAMES = {
  coolantPurge, wireSplice, spectrometer, cargoSort, airlockPressurize, identScan, debrisClear, seedCatalogue, dataUpload, reactorCalibrate,
  lightsFix, commsFix, reactorHold, o2Code,
};

export function getMinigame(id) { return MINIGAMES[id] || null; }

// Difficulty scales with player count.
export function difficultyFor(playerCount) { return 1 + Math.max(0, playerCount - 4) * 0.1; }
