module.exports = {
  apps: [
    {
      name: 'nexusos-api',
      script: 'dist/server.js',
      cwd: '/var/www/nexusos-backend',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      time: true
    }
  ]
}
