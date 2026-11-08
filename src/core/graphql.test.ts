import { describe, it, expect } from 'vitest';
import { operationName } from './graphql';

describe('graphql operationName', () => {
  it('reads operationName field from JSON object', () => {
    expect(operationName('{"operationName":"GetMe"}')).toBe('GetMe');
    expect(operationName('{"operationName":"GetUser","query":"query Other { viewer { id } }"}')).toBe('GetUser');
  });

  it('reads operation name from query string when operationName is missing or null', () => {
    expect(operationName('{"query":"query GetMe { viewer { id } }"}')).toBe('GetMe');
    expect(operationName('{"query":"mutation Save($input: Input) { save(input: $input) { id } }"}')).toBe('Save');
    expect(operationName('{"query":"subscription OnMessage { messageReceived { text } }"}')).toBe('OnMessage');
    expect(operationName('{"operationName":null,"query":"query GetProfile { me { name } }"}')).toBe('GetProfile');
  });

  it('returns null for anonymous queries', () => {
    expect(operationName('{"query":"{ viewer { id } }"}')).toBeNull();
    expect(operationName('{"query":"query { viewer { id } }"}')).toBeNull();
    expect(operationName('{"query":"mutation { reset }"}')).toBeNull();
  });

  it('returns null for invalid JSON, arrays, non-objects, and missing bodies', () => {
    expect(operationName('not json')).toBeNull();
    expect(operationName('[{"operationName":"GetMe"}]')).toBeNull();
    expect(operationName('123')).toBeNull();
    expect(operationName('"string"')).toBeNull();
    expect(operationName('null')).toBeNull();
    expect(operationName('')).toBeNull();
    expect(operationName(undefined)).toBeNull();
  });
});
