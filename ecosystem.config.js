module.exports = {
  apps: [
    {
      name: 'mission-control',
      cwd: '/Users/josh/.openclaw/workspace/mission-control',
      script: 'npm',
      args: 'run start -- -p 3005',
      env: {
        NODE_ENV: 'production',
        OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN || '',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'mission-control-canary',
      cwd: '/Users/josh/.openclaw/workspace/mission-control',
      script: 'npm',
      args: 'run start -- -p 3006',
      env: {
        NODE_ENV: 'production',
        OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN || '',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
