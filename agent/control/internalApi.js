// Localhost-only HTTP control channel the token server uses to tell the agent when a
// session starts/stops. Never proxied by nginx, never leaves the box.
import http from "node:http";

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function createInternalApi({ secret, onJoin, onLeave, onHealth }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/agent/health") {
        sendJson(res, 200, await onHealth());
        return;
      }

      if (!secret || req.headers["x-agent-secret"] !== secret) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (req.method === "POST" && req.url === "/agent/join") {
        const { roomName } = await readJson(req);
        if (!roomName) {
          sendJson(res, 400, { error: "roomName is required" });
          return;
        }
        await onJoin({ roomName });
        sendJson(res, 200, { joined: roomName });
        return;
      }

      if (req.method === "POST" && req.url === "/agent/leave") {
        const { roomName } = await readJson(req);
        if (!roomName) {
          sendJson(res, 400, { error: "roomName is required" });
          return;
        }
        await onLeave({ roomName });
        sendJson(res, 200, { left: roomName });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}
