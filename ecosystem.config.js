module.exports = {
  apps: [
    {
      name: "backend-server",
      script: "server.js",
      cwd: "./backend",
      interpreter: "node",
      watch: false
    },
    {
      name: "frontend",
      script: "npm",
      args: "start",
      cwd: "./frontend",
      interpreter: "node",
      watch: false
    },
    {
      name: "audio2face-grpc-client",
      script: "grpc_client.py",
      cwd: "./backend/audio2face",
      interpreter: "./backend/audio2face/.venv/bin/python",
      watch: false
    }
  ]
};
