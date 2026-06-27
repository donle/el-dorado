/**
 * controllers/interaction — barrel for the interaction modules.
 * Stage J1 exports LegalityHelper; Stage J2 exports ActionCardHelper.
 */
export { LegalityHelper, type LegalityContext } from './legality.js';
export { ActionCardHelper, type ActionCardSelection } from './actionCards.js';