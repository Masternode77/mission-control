module.exports = {
  apps: [
    {
      name: 'mission-control-3005',
      cwd: '/Users/josh/.openclaw/workspace/mission-control',
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        OPENCLAW_GATEWAY_URL: 'ws://127.0.0.1:18789',
        OPENCLAW_GATEWAY_TOKEN: 'b3d65d6864b3b134b5e627314c85ba0480fa14f3e2c54542',
        NODE_ENV: 'production'
      },
      output: '/Users/josh/.openclaw/workspace/mission-control/logs/pm2-out.log',
      error: '/Users/josh/.openclaw/workspace/mission-control/logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }
  ]
};
