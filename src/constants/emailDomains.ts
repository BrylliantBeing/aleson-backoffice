// Mail domains offered once the clerk types "@".
//
// Unlike the ID types, this is a convenience list and NOT a closed vocabulary:
// any domain a passenger gives is valid, so anything typed here is kept exactly
// as keyed. The list only exists to save the clerk the twelve keystrokes that
// nine sales in ten need.
//
// Ordering is deliberate, not alphabetical: the counter's common domains sit at
// the top so the usual case is one Tab. The Malaysian entries earn their place
// on the Sandakan run.
export const PINNED_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
] as const;

const OTHER_EMAIL_DOMAINS = [
  'aol.com',
  'gmx.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'proton.me',
  'protonmail.com',
  'rocketmail.com',
  'yahoo.com.ph',
  'yahoo.com.my',
  'ymail.com',
] as const;

export const EMAIL_DOMAINS: string[] = [...PINNED_EMAIL_DOMAINS, ...OTHER_EMAIL_DOMAINS];
