const WebSocket = require('ws');
const http = require('http');

const PLACA_ID = 'torre';
const API_LOCAL_PORT = 8000;
const RECONNECT_TIMEOUT = 10000; // 10 seconds in milliseconds

let ws;
let reconnectTimer;

function connectWebSocket() {
  // Clear any existing timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  ws = new WebSocket('ws://shm.sytes.net/ws-tunnel', {
    maxPayload: 10 * 1024 * 1024 * 1024,
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'register', id: PLACA_ID }));
    console.log('📡 Conectado al túnel como:', PLACA_ID);
  });

  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.type !== 'request') return;

    console.log('🔄 Solicitud recibida:', data.path);

    // Clean headers to prevent issues
    const headers = { ...data.headers };

    // Remove problematic headers
    delete headers['content-length']; // Let Node.js calculate this
    delete headers['host']; // This will be set automatically 

    const options = {
      hostname: 'localhost',
      port: API_LOCAL_PORT,
      path: data.path,
      method: data.method,
      headers: headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', chunk => {
        try {
          chunks.push(chunk);
        } catch (error) {
          console.error('Error al procesar el chunk:', error.message);
        }
      });
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        ws.send(JSON.stringify({
          type: 'response',
          id: data.id,
          statusCode: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: body.toString()
        }));
      });
    });

    // Add error handling for the HTTP request
    proxyReq.on('error', (error) => {
      console.error('Error en la solicitud HTTP:', error.message);

      // Send error response back through WebSocket
      ws.send(JSON.stringify({
        type: 'response',
        id: data.id,
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          code: error.code,
          details: 'Error al procesar la solicitud en el cliente del túnel'
        })
      }));
    });

    if (data.body) {
      // Check if data.body is a serialized Buffer object
      if (data.body.type === 'Buffer' && Array.isArray(data.body.data)) {
        // Reconstruct Buffer from serialized data
        const buffer = Buffer.from(data.body.data);
        proxyReq.write(buffer);
      } else if (typeof data.body === 'string') {
        // Handle string data
        proxyReq.write(data.body);
      } else if (Buffer.isBuffer(data.body)) {
        // Handle actual Buffer
        proxyReq.write(data.body);
      } else {
        // Fallback: convert to string
        proxyReq.write(String(data.body));
      }
    }

    proxyReq.end();
  });

  ws.on('error', (error) => {
    console.error('Error en la conexión WebSocket:', error.message);
  });

  ws.on('close', () => {
    console.log('Conexión WebSocket cerrada. Reintentando en 10 segundos...');
    // Schedule reconnect after 1 minute
    reconnectTimer = setTimeout(() => {
      console.log('Intentando reconectar...');
      connectWebSocket();
    }, RECONNECT_TIMEOUT);
  });
}

// Initialize connection
connectWebSocket();
