import { clearSessionCookieHeader, sessionCookieHeader } from './session-cookie';

describe('session cookie', () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  });

  it('uses SameSite=Lax without Secure in development', () => {
    process.env.NODE_ENV = 'development';
    const header = sessionCookieHeader('session-token');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
    expect(header).not.toContain('SameSite=None');
    expect(header).not.toMatch(/Domain=/i);
  });

  it('uses SameSite=None and Secure in production, including when clearing the cookie', () => {
    process.env.NODE_ENV = 'production';
    const created = sessionCookieHeader('session-token');
    const cleared = clearSessionCookieHeader();
    for (const header of [created, cleared]) {
      expect(header).toContain('SameSite=None');
      expect(header).toContain('Secure');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Path=/');
      expect(header).not.toContain('SameSite=Lax');
      expect(header).not.toMatch(/Domain=/i);
    }
    expect(cleared).toContain('hub_session=;');
    expect(cleared).toContain('Max-Age=0');
  });
});
