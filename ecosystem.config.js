module.exports = {
  apps: [{
    name: 'discord-bot',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time: true,
    // Restart delay
    restart_delay: 4000,
    // Max restarts trong 1 phút
    max_restarts: 10,
    min_uptime: '10s',
    // Auto restart khi file thay đổi (development only)
    ignore_watch: ['node_modules', 'logs', 'data'],
    // Environment variables
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
