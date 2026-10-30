// The object carries invalidation signals only. Authorization and the pending
// count remain in the worker and D1 respectively.
export class AccessLive {
  constructor(state) { this.state=state }
  async fetch(request) {
    if(request.method==='POST') { await this.changed(); return new Response(null,{status:204}) }
    const [client,server]=Object.values(new WebSocketPair())
    this.state.acceptWebSocket(server)
    return new Response(null,{status:101,webSocket:client})
  }
  async changed() {
    for(const socket of this.state.getWebSockets()) {
      try { socket.send('changed') } catch {}
    }
  }
  webSocketMessage() {}
  webSocketClose(socket) { socket.close() }
}

export function accessLive(env) { return env.ACCESS_LIVE?.getByName('dashboard') }
export async function accessChanged(env) { await accessLive(env)?.fetch('https://access-live.internal/',{method:'POST'}) }
