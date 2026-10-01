/**
 * The Analyst chart standard: colours, units and layout for every chart in the app.
 *
 * Import from `@/lib/charts` and nowhere else. A hex colour, a unit conversion or an
 * analysis-window shape defined in a card's own `utils/` is what this package exists to
 * stop — four palettes and four diverging copies of `getUnitConversion` is where it
 * started.
 */

export * from './tokens';
export * from './units';
export * from './format';
export * from './layout';
