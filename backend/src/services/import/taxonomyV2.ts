/**
 * Behavioural taxonomy + regex rules aligned with `ml-training/notebooks/experimentation.ipynb`
 * V2 (`category_map_v2` / `regex_rules_v2`). Rule targets use notebook category names;
 * `Transport & Auto` in the notebook is normalized to `Transport & Car` to match map keys.
 */

export const CATEGORY_MAP_V2: Readonly<Record<string, string>> = {
  'Housing & Utilities':
    'Essential housing mortgage rent council tax electricity gas water heating bills DIY repairs',
  'Insurance & Finance':
    'Essential insurance premiums auto home health life bank fees loan repayments financial charges',
  'Telecom & Software':
    'Fixed recurring telecom internet broadband mobile phone software productivity subscriptions',
  Groceries:
    'Essential groceries supermarket food shopping household supplies toiletries',
  'Transport & Car':
    'Essential public transport trains buses commute car fuel petrol parking car maintenance',
  'Health & Care':
    'Essential health pharmacy medical dental personal care therapy childcare petcare',
  'Dining Out':
    'Discretionary eating out restaurants cafes coffee shops pubs bars social dining',
  'Takeaways & Delivery':
    'Discretionary fast food takeaways convenient food delivery apps',
  'Shopping & Retail':
    'Discretionary retail shopping clothing apparel electronics home upgrades hobbies gifts',
  'Entertainment & Leisure':
    'Discretionary entertainment events cinema gym memberships media streaming tv video games',
  'Travel & Holidays':
    'Discretionary travel tourism flights hotels vacations holidays leisure trips',
  'Savings & Investments':
    'Wealth transfers savings accounts investments stocks crypto pensions',
  Income: 'Incoming money salary wage payroll dividends refunds cashback',
  'Cash & Unknown':
    'Cash withdrawals ATM transfers to friends unknown expenses miscellaneous',
};

export const CATEGORY_LABELS_V2 = Object.keys(CATEGORY_MAP_V2) as readonly string[];

/** First matching pattern wins (same as notebook iteration order). */
export const REGEX_RULES_V2: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:TESCO|SAINSBURYS|ASDA|WAITROSE|ALDI|LIDL|MIMEO|B AND M)\b/, 'Groceries'],
  [
    /\b(?:HSBC|BARCLAYS|LLOYDS|NATWEST|HALIFAX|SANTANDER|MONZO|MOORCROFT GROUP)\b/,
    'Insurance & Finance',
  ],
  [
    /\b(?:MCDONALDS|KFC|BURGER KING|NANDOS|COSTA|STARBUCKS|UPPERCRUST|FULLER SMITH|JD WETHERSPOON)\b/,
    'Dining Out',
  ],
  [/\b(?:UBER|UBEREATS|DELIVEROO|JUST EAT)\b/, 'Takeaways & Delivery'],
  [/\b(?:TFL|TRAINLINE|RAIL|ARRIVA|STAGECOACH)\b/, 'Transport & Car'],
  [
    /\b(?:NETFLIX|SPOTIFY|AMAZON PRIME|DISNEY PLUS|CURSOR, AI|UNISON|NOW)\b/,
    'Entertainment & Leisure',
  ],
  [
    /\b(?:MAX SPIELMANN|NYX|EDUBOX|EDE AND RAVENSCROF|WH SMITH|TGTG|AMIGO @ HAMMERSMIT|MR SIMMS OLDE SWEE|WELCOME BREAK-LOND|DUNELM|SIMMONS|AMZNMKTPLACE|H AND M)\b/,
    'Shopping & Retail',
  ],
  [/\b(?:ANIMAL FRIENDS INS|COMPANION C|PETSATHOME)\b/, 'Health & Care'],
  [/\b(DVLA-[A-Z]{2}\d{2}\s?[A-Z]{3}|SHELL)\b/, 'Transport & Car'],
  [/\b(AO-OPTICALSERVICES|ADARO. VISIONEXPRE)\b/, 'Health & Care'],
  [/\b(SA_SUPPORT)\b/, 'Telecom & Software'],
  [/\b(SCREWFIX)\b/, 'Housing & Utilities'],
  [/\b(EE D)\b/, 'Telecom & Software'],
  [/\b(NOTEMACHINE NOTEMACHINE)\b/, 'Cash & Unknown'],
];
