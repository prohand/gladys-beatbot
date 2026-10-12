// -----------------------------------------------------------------------------
// Errors of the Beatbot cloud client.
//
// Two kinds matter to the rest of the code: an AUTH error means the user has
// to sign in again (shown in the Configuration screen), a CONNECTION error is
// transient (retried, the integration keeps running).
// -----------------------------------------------------------------------------

export class BeatbotError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The authorization is invalid: only a new sign-in fixes it. */
export class BeatbotAuthError extends BeatbotError {}

/** The cloud could not be reached, or answered something unusable. */
export class BeatbotConnectionError extends BeatbotError {}
