import { createContext } from 'react';

/**
 * Whether the test-run tab a card sits in is the one on screen. Visited tabs stay mounted
 * while hidden, so a card's own timers (polls, intervals) keep running unless they check this.
 * Defaults to true for a card rendered outside the page's tab panels.
 */
export const TabActiveContext = createContext(true);
