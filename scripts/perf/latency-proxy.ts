// A TCP proxy that adds a fixed delay to every packet in both directions, so a local Postgres
// behaves like one across a network. Without it a perf run on localhost hides the cost of serial
// round trips, which is what actually makes a page slow against Supabase's pooler.
// Usage: tsx scripts/perf/latency-proxy.ts <listenPort> <targetPort> <delayMs>
import net from 'node:net';

const [listen, target, delay] = process.argv.slice(2).map(Number);

net
  .createServer((client) => {
    const upstream = net.connect(target!, '127.0.0.1');
    const pipe = (from: net.Socket, to: net.Socket) =>
      from.on('data', (chunk) => {
        setTimeout(() => to.writable && to.write(chunk), delay!);
      });
    pipe(client, upstream);
    pipe(upstream, client);
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', end).on('close', end);
    upstream.on('error', end).on('close', end);
  })
  .listen(listen!, () => console.log(`proxy :${listen} -> :${target} (+${delay}ms each way)`));
