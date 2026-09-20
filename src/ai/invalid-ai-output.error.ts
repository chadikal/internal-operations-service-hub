export class InvalidAiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAiOutputError';
  }
}
