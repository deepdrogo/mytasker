import { describe, expect, it } from 'vitest';
import { ApiError, buildQuery } from './client';

describe('api client', () => {
  it('serialises query params, skipping empty values and expanding arrays', () => {
    expect(buildQuery({ a: 1, b: 'x', c: undefined, d: null, e: '', f: [1, 2], g: false })).toBe('?a=1&b=x&f=1&f=2&g=false');
    expect(buildQuery(undefined)).toBe('');
  });

  it('exposes code, status and field errors', () => {
    const err = new ApiError(400, { code: 'validation_error', message: 'Invalid', fields: { title: ['Required'] } });
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
    expect(err.fields.title).toEqual(['Required']);
    expect(err.message).toBe('Invalid');
  });
});
