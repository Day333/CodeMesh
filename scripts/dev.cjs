const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const root = path.join(__dirname, "..");
const vite = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
  ],
  { cwd: root, stdio: "inherit" },
);
let electron;

function waitForPort(attempts = 60) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(5173, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", () => {
      socket.destroy();
      if (attempts <= 0) reject(new Error("Vite 未能启动"));
      else
        setTimeout(() => waitForPort(attempts - 1).then(resolve, reject), 250);
    });
  });
}

function stop() {
  electron?.kill();
  vite.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

waitForPort()
  .then(() => {
    electron = spawn(require("electron"), ["."], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CODEMESH_DEV_URL: "http://127.0.0.1:5173" },
    });
    electron.once("exit", (code) => {
      vite.kill();
      process.exitCode = code || 0;
    });
  })
  .catch((error) => {
    console.error(error);
    vite.kill();
    process.exitCode = 1;
  });
