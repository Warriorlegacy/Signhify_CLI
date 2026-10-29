export class AbortError extends Error {
  readonly code: string = 'ABORT_ERR';

  constructor(message = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
