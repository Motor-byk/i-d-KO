import { io as connect } from 'socket.io-client';
import { createAppServer } from '../server/index.js';

// Starts a server on a random port; returns a client factory and cleanup.
export async function startServer(t) {
  const app = createAppServer();
  await new Promise((r) => app.httpServer.listen(0, r));
  const url = `http://localhost:${app.httpServer.address().port}`;
  const clients = [];
  t.after(() => {
    clients.forEach((c) => c.disconnect());
    app.io.close();
  });
  const client = async () => {
    const c = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(c);
    await new Promise((r) => c.once('connect', r));
    return c;
  };
  return { ...app, url, client };
}

export const call = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export const nextEvent = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));
