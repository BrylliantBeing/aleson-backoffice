/**
 * Domain completion for the counter's email box.
 *
 * Kept apart from the field that draws it so the rules can be tested directly:
 * what completes, what does not, and where the selection falls are the whole
 * behaviour, and they are easier to be sure of as functions than as keystrokes.
 *
 * The vocabulary is OPEN. Nothing here ever rejects or rewrites an address —
 * an email is whatever the passenger says it is, and these helpers only offer a
 * tail the clerk can take or type straight past.
 */

import { EMAIL_DOMAINS } from "@/constants/emailDomains";

export interface EmailParts {
  /** Index of the last "@", or -1 when there is none. */
  at: number;
  local: string;
  /** Lower-cased text after the last "@". */
  query: string;
}

/** Split on the LAST "@" — a local part may legally contain one, and the
 *  domain is always what follows the final one. */
export const splitEmail = (text: string): EmailParts => {
  const at = text.lastIndexOf("@");
  return {
    at,
    local: at < 0 ? text : text.slice(0, at),
    query: at < 0 ? "" : text.slice(at + 1).toLowerCase(),
  };
};

/** How close a domain is to what was typed; -1 when it isn't a match. */
const rank = (domain: string, query: string): number => {
  if (!query) return 0;
  if (domain.startsWith(query)) return 0;
  // "ph" reaching yahoo.com.ph: the clerk often knows the tail, not the head.
  if (domain.split(".").some((part) => part.startsWith(query))) return 1;
  if (domain.includes(query)) return 2;
  return -1;
};

/**
 * Domains worth offering for what has been typed so far.
 *
 * Empty until there is an address to complete: no "@" yet, or an "@" with no
 * local part in front of it. Before that every keystroke is the local part and
 * there is nothing to guess.
 */
export const emailMatches = (text: string): string[] => {
  const { at, local, query } = splitEmail(text);
  if (at <= 0 || !local.trim()) return [];
  return EMAIL_DOMAINS.map((domain, i) => ({ domain, r: rank(domain, query), i }))
    .filter((m) => m.r >= 0)
    // Ties keep the list's own order, which puts the counter's three commonest
    // domains first.
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((m) => m.domain);
};

export interface EmailCompletion {
  /** The address with the domain filled in. */
  text: string;
  /** Where the filled-in tail starts, so it can be left selected and typed over. */
  selectionStart: number;
}

/** Put `domain` on the end of `text`, reporting where the added tail begins. */
export const completeWith = (text: string, domain: string): EmailCompletion | null => {
  const { at, local, query } = splitEmail(text);
  if (at <= 0) return null;
  return { text: `${local}@${domain}`, selectionStart: at + 1 + query.length };
};

/**
 * The completion to show for freshly typed `text`, or null to leave it alone.
 *
 * Only a domain that *extends* what was keyed is offered. One that merely
 * contains it would have to delete the clerk's letters to display itself, so
 * those stay in the list and wait to be picked.
 */
export const completionFor = (text: string): EmailCompletion | null => {
  const { query } = splitEmail(text);
  const best = emailMatches(text)[0];
  if (!best || !best.startsWith(query)) return null;
  return completeWith(text, best);
};

/**
 * True when this change only walks back what was already keyed.
 *
 * Backspace has to be able to shorten the field, so a deletion must not
 * complete again — otherwise the tail the clerk just removed reappears and the
 * box cannot be emptied. Typing over the selected tail also shortens the text,
 * but replaces the prefix rather than trimming it, so that still completes.
 */
export const isDeletion = (prev: string, next: string): boolean =>
  next.length <= prev.length && prev.toLowerCase().startsWith(next.toLowerCase());
