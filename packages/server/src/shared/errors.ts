import type { ErrorCode } from '@eldorado/core';

export class GameError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'GameError';
  }
}

export class ActionValidationError extends GameError {
  constructor(message: string) {
    super('INVALID_ACTION', message);
    this.name = 'ActionValidationError';
  }
}

export class ConnectionError extends GameError {
  constructor(message: string) {
    super('CONNECTION_LOST', message);
    this.name = 'ConnectionError';
  }
}
