module.exports = {
  apps: [{
    name: 'gs-ml',
    script: 'uvicorn',
    args: 'app:app --host 0.0.0.0 --port 8001',
    cwd: '/opt/gs-ml',
    interpreter: '/opt/gs-ml/venv/bin/python',
    env: {
      PORT: '8001',
    },
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
