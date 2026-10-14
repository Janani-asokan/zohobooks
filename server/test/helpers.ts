import request from 'supertest';
import { createApp } from '../src/app';
import { seed } from '../src/seed';

export const app = createApp();

export async function freshDb() {
  await seed({ quiet: true });
}

/** A cookie-keeping client that sends the CSRF header on every request. */
export async function login(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'ledgerly').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => agent[m](url).set('X-Requested-With', 'ledgerly');
  return { agent, me: res.body, get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete') };
}

export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
