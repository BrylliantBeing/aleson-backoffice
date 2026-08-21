// Kinds of identification accepted on the passenger manifest.
//
// A fixed list rather than free text, for the same reason nationalities are one:
// the manifest is read by the coast guard and by Malaysian immigration on the
// Sandakan run, and "DL"/"drivers licence"/"LTO ID" all being the same document
// matters more than letting the cashier type anything.
//
// Ordering is deliberate, not alphabetical: the documents presented at almost
// every counter sale sit at the top so the common case is one tap, and the rest
// follow alphabetically for scanning.
export const PINNED_ID_TYPES = [
  'Passport',
  'National ID (PhilSys)',
  "Driver's License",
] as const;

const OTHER_ID_TYPES = [
  'Barangay ID',
  'Birth Certificate',
  'Company ID',
  'GSIS ID',
  'Malaysian IC (MyKad)',
  'OFW / OWWA ID',
  'PWD ID',
  'PhilHealth ID',
  'Postal ID',
  'PRC ID',
  "Seaman's Book (SIRB)",
  'Senior Citizen ID',
  'SSS ID',
  'School / Student ID',
  'UMID',
  "Voter's ID",
  'Other',
] as const;

export const ID_TYPES: string[] = [...PINNED_ID_TYPES, ...OTHER_ID_TYPES];
